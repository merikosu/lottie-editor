/**
 * Find & replace bar for the JSON editor, rendered by React into CodeMirror's search panel
 * slot (so CodeMirror still owns the query state, match highlighting and keymaps).
 */
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import type { EditorState, Text } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronRight,
  Regex,
  Search,
  WholeWord,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button, IconButton, Tooltip } from '@/components/ui'
import { fieldFrame } from '@/components/ui/field'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { session, useSearchPanel } from './session'

const MAX_COUNT = 9999

interface Counts {
  total: number
  /** 1-based index of the selected match, 0 when the selection is not a match. */
  current: number
  capped: boolean
}

let totalCache: { doc: Text; query: SearchQuery; total: number; capped: boolean } | null = null

function countMatches(state: EditorState, query: SearchQuery): Counts {
  if (!query.valid) return { total: 0, current: 0, capped: false }
  if (!totalCache || totalCache.doc !== state.doc || !totalCache.query.eq(query)) {
    let total = 0
    const cursor = query.getCursor(state)
    for (let m = cursor.next(); !m.done && total < MAX_COUNT; m = cursor.next()) total++
    totalCache = { doc: state.doc, query, total, capped: total >= MAX_COUNT }
  }
  const sel = state.selection.main
  let current = 0
  if (!sel.empty && totalCache.total > 0) {
    // Matches before the selection, plus one if the selection itself is a match.
    let before = 0
    const cursor = query.getCursor(state, 0, sel.to)
    for (let m = cursor.next(); !m.done; m = cursor.next()) {
      if (m.value.from === sel.from && m.value.to === sel.to) {
        current = before + 1
        break
      }
      before++
      if (before >= MAX_COUNT) break
    }
  }
  return { total: totalCache.total, current, capped: totalCache.capped }
}

/** Selects the first match at or after `from` (wrapping around), without moving focus. */
function selectMatchFrom(view: EditorView, query: SearchQuery, from: number): void {
  if (!query.valid) return
  let m = query.getCursor(view.state, from).next()
  if (m.done) m = query.getCursor(view.state, 0, from).next()
  if (m.done) return
  const { from: a, to: b } = m.value
  view.dispatch({
    selection: EditorSelection.single(a, b),
    effects: EditorView.scrollIntoView(a, { y: 'center' }),
    userEvent: 'select.search',
  })
}

function FieldToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors',
          active
            ? 'bg-accent-subtle text-accent-text'
            : 'text-fg-subtle hover:bg-hover hover:text-fg',
        )}
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  )
}

export function SearchPanel() {
  const t = useT()
  // Re-render when CodeMirror's query, selection or text changes.
  useSearchPanel((s) => s.version)
  const view = session.editorView
  const findRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  // Where incremental search starts (the cursor when the bar opened or after navigating).
  const anchor = useRef(view?.state.selection.main.from ?? 0)

  const query = view ? getSearchQuery(view.state) : null

  // Keep the uncontrolled fields in step with queries set by CodeMirror (⌘F on a selection).
  useLayoutEffect(() => {
    const find = findRef.current
    if (find && query && find.value !== query.search && document.activeElement !== find)
      find.value = query.search
    const rep = replaceRef.current
    if (rep && query && rep.value !== query.replace && document.activeElement !== rep)
      rep.value = query.replace
  })

  useEffect(() => {
    const find = findRef.current
    if (!find) return
    find.focus()
    find.select()
  }, [])

  if (!view || !query) return null

  const push = (
    patch: Partial<{
      search: string
      replace: string
      caseSensitive: boolean
      regexp: boolean
      wholeWord: boolean
    }>,
    jump: boolean,
  ) => {
    const next = new SearchQuery({
      search: patch.search ?? query.search,
      replace: patch.replace ?? query.replace,
      caseSensitive: patch.caseSensitive ?? query.caseSensitive,
      regexp: patch.regexp ?? query.regexp,
      wholeWord: patch.wholeWord ?? query.wholeWord,
      literal: query.literal,
    })
    view.dispatch({ effects: setSearchQuery.of(next) })
    if (jump) selectMatchFrom(view, next, anchor.current)
  }

  const navigate = (dir: 1 | -1) => {
    if (dir > 0) findNext(view)
    else findPrevious(view)
    anchor.current = view.state.selection.main.from
  }

  const close = () => {
    closeSearchPanel(view)
    view.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, field: 'find' | 'replace') => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      if (field === 'replace') replaceNext(view)
      else navigate(e.shiftKey ? -1 : 1)
      return
    }
    if (runScopeHandlers(view, e.nativeEvent, 'search-panel')) e.preventDefault()
  }

  const counts = countMatches(view.state, query)
  let countLabel: string | null = null
  let countTone = 'text-fg-subtle'
  if (query.search) {
    if (!query.valid) {
      countLabel = t.code.search.invalid
      countTone = 'text-danger'
    } else if (counts.total === 0) {
      countLabel = t.code.search.noResults
      countTone = 'text-fg-faint'
    } else if (counts.current > 0) {
      countLabel = t.code.search.count(counts.current, counts.total) + (counts.capped ? '+' : '')
    } else {
      countLabel = counts.capped
        ? t.code.search.manyMatches(counts.total)
        : t.code.search.matches(counts.total)
    }
  }
  const hasMatches = query.valid && counts.total > 0

  return (
    <div className="flex items-start gap-1 py-1.5 pr-1.5 pl-1" data-testid="code-search">
      <IconButton
        icon={ChevronRight}
        label={t.code.search.toggleReplace}
        active={replaceOpen}
        onClick={() => setReplaceOpen((o) => !o)}
        className={cn('[&_svg]:transition-transform', replaceOpen && '[&_svg]:rotate-90')}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-0.5">
          <div className={cn(fieldFrame, 'h-6 w-full max-w-96 pr-0.5 text-sm')}>
            <Search size={14} className="ml-1.5 shrink-0 text-fg-subtle" />
            <input
              ref={findRef}
              main-field="true"
              defaultValue={query.search}
              placeholder={t.code.search.find}
              aria-label={t.code.search.find}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => push({ search: e.currentTarget.value }, true)}
              onKeyDown={(e) => onKeyDown(e, 'find')}
              className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-fg outline-none placeholder:text-fg-faint"
            />
            {countLabel && (
              <output
                className={cn('shrink-0 px-1 text-xs whitespace-nowrap tabular-nums', countTone)}
              >
                {countLabel}
              </output>
            )}
            <FieldToggle
              icon={CaseSensitive}
              label={t.code.search.matchCase}
              active={query.caseSensitive}
              onClick={() => push({ caseSensitive: !query.caseSensitive }, true)}
            />
            <FieldToggle
              icon={WholeWord}
              label={t.code.search.wholeWord}
              active={query.wholeWord}
              onClick={() => push({ wholeWord: !query.wholeWord }, true)}
            />
            <FieldToggle
              icon={Regex}
              label={t.code.search.regexp}
              active={query.regexp}
              onClick={() => push({ regexp: !query.regexp }, true)}
            />
          </div>
          <IconButton
            icon={ArrowUp}
            label={t.code.search.previous}
            shortcut="shift+enter"
            disabled={!hasMatches}
            onClick={() => navigate(-1)}
          />
          <IconButton
            icon={ArrowDown}
            label={t.code.search.next}
            shortcut="enter"
            disabled={!hasMatches}
            onClick={() => navigate(1)}
          />
          <div className="flex-1" />
          <IconButton icon={X} label={t.code.search.close} shortcut="escape" onClick={close} />
        </div>
        {replaceOpen && (
          <div className="flex items-center gap-1">
            <div className={cn(fieldFrame, 'h-6 w-full max-w-96 text-sm')}>
              <input
                ref={replaceRef}
                defaultValue={query.replace}
                placeholder={t.code.search.replace}
                aria-label={t.code.search.replace}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => push({ replace: e.currentTarget.value }, false)}
                onKeyDown={(e) => onKeyDown(e, 'replace')}
                // Text lines up with the find field's text (after its search icon).
                className="h-full min-w-0 flex-1 bg-transparent pr-1.5 pl-[26px] text-fg outline-none placeholder:text-fg-faint"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!hasMatches}
              onClick={() => replaceNext(view)}
            >
              {t.code.search.replaceOne}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!hasMatches}
              onClick={() => replaceAll(view)}
            >
              {t.code.search.replaceAll}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
