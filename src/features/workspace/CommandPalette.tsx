/**
 * Command palette (⌘K): every command, the document's layers and values such as "42" (go to
 * frame) or "1.5x" (preview speed), in one searchable list. It works on every page; actions
 * that belong to another page open it first (see palette/placement.ts).
 *
 * Closing returns focus to where it was, and a chosen action runs only after that, so a dialog
 * opened by the command takes focus cleanly and returns it properly.
 */
import { Command } from 'cmdk'
import { Search } from 'lucide-react'
import { Dialog as RadixDialog, VisuallyHidden } from 'radix-ui'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useRoute } from '@/app/router'
import { useCommands } from '@/commands/registry'
import { matchesShortcut } from '@/commands/shortcuts'
import { useT } from '@/i18n'
import { isMac } from '@/lib/platform'
import { useDocument } from '@/store/document'
import { usePlayback } from '@/store/playback'
import { setCommandPaletteOpen, useUi } from '@/store/ui'
import { ensureAllLanguages } from '@/i18n'
import { performRow } from './palette/actions'
import { buildCandidates } from './palette/candidates'
import { buildLayerIndex } from './palette/layer-index'
import { PaletteRowView } from './palette/PaletteRows'
import { parseQuickActions } from './palette/quick-actions'
import { usePaletteRecent } from './palette/recent'
import { buildSections, type PaletteRow } from './palette/sections'

/** Shortcuts that open the palette also close it (toggle). */
const TOGGLE_SHORTCUTS = ['mod+k', 'mod+shift+p']

/** Upper bound for the close → focus-restore → run sequence (normally one task). */
const RUN_FALLBACK_MS = 250

function onPaletteKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
  if (TOGGLE_SHORTCUTS.some((sc) => matchesShortcut(e.nativeEvent, sc))) {
    e.preventDefault()
    setCommandPaletteOpen(false)
  }
}

function PaletteBody({
  query,
  onQueryChange,
  onChoose,
}: {
  query: string
  onQueryChange: (query: string) => void
  onChoose: (row: PaletteRow) => void
}) {
  const t = useT()
  const p = t.workspace.palette
  const commands = useCommands()
  const route = useRoute()
  const doc = useDocument((s) => s.doc)
  const selection = useDocument((s) => s.selection)
  const hasWorkArea = usePlayback((s) => s.workArea !== null)
  const speed = usePlayback((s) => s.speed)
  const recent = usePaletteRecent((s) => s.ids)

  // enabled()/checked() are read when the palette opens and whenever the editor state they
  // usually depend on changes.
  const candidates = useMemo(
    () =>
      buildCandidates(commands.values(), t, {
        hasDocument: doc !== null,
        hasNodes: selection.nodes.length > 0,
        hasKeyframes: selection.keyframes.length > 0,
        hasWorkArea,
      }),
    [commands, t, doc, selection, hasWorkArea],
  )
  const layers = useMemo(() => (doc ? buildLayerIndex(doc, t) : null), [doc, t])
  const sections = useMemo(
    () =>
      buildSections({
        query,
        commands: candidates,
        layers,
        recent,
        quick: parseQuickActions(query, doc),
        t,
        route,
      }),
    [query, candidates, layers, recent, doc, t, route],
  )

  return (
    <Command
      label={p.title}
      shouldFilter={false}
      loop
      // Ctrl+K opens the palette on Windows/Linux, so cmdk's Ctrl+J/K/N/P navigation is macOS-only.
      vimBindings={isMac}
      onKeyDown={onPaletteKeyDown}
      className="flex min-h-0 flex-col"
    >
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
        <Search size={16} className="shrink-0 text-fg-subtle" aria-hidden />
        <Command.Input
          value={query}
          onValueChange={onQueryChange}
          placeholder={doc ? p.placeholder : p.placeholderNoDocument}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-faint"
          data-testid="palette-input"
        />
      </div>
      <Command.List
        label={p.title}
        className="max-h-[min(440px,calc(78vh-56px))] overflow-y-auto overscroll-contain px-1.5 pt-1 pb-1.5"
      >
        <Command.Empty className="flex flex-col items-center gap-1 px-6 py-8 text-center">
          <span className="text-sm text-fg-muted">{p.empty(query.trim())}</span>
          <span className="text-xs text-fg-subtle">
            {doc ? p.emptyHint : p.emptyHintNoDocument}
          </span>
        </Command.Empty>
        {sections.map((section) => (
          <Command.Group
            key={section.id}
            value={section.id}
            heading={
              section.heading ? (
                <span className="flex h-7 items-end px-2.5 pb-1 text-xs font-medium text-fg-subtle">
                  {section.heading}
                </span>
              ) : undefined
            }
            className={section.heading ? undefined : 'pt-0.5'}
          >
            {section.rows.map((row) => (
              <PaletteRowView
                key={row.value}
                row={row}
                onSelect={onChoose}
                fps={doc?.fr ?? 30}
                speed={speed}
              />
            ))}
            {section.more ? (
              <div className="flex h-7 items-center pl-9 text-xs text-fg-subtle">
                {p.moreLayers(section.more)}
              </div>
            ) : null}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  )
}

/** Mounted while open, so the query starts empty every time. */
function PaletteDialog({
  onChoose,
  onCloseAutoFocus,
}: {
  onChoose: (row: PaletteRow) => void
  onCloseAutoFocus: (e: Event) => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/40" />
      <RadixDialog.Content
        aria-describedby={undefined}
        data-testid="command-palette"
        // Like Spotlight: Esc first clears the query, then closes.
        onEscapeKeyDown={(e) => {
          if (query) {
            e.preventDefault()
            setQuery('')
          }
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        className="fixed inset-x-0 top-[18vh] z-50 mx-auto flex w-[560px] max-w-[calc(100vw-32px)] animate-pop-in flex-col overflow-hidden rounded-xl bg-surface-3 text-fg shadow-dialog outline-none"
      >
        <VisuallyHidden.Root>
          <RadixDialog.Title>{t.workspace.palette.title}</RadixDialog.Title>
        </VisuallyHidden.Root>
        <PaletteBody query={query} onQueryChange={setQuery} onChoose={onChoose} />
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

export function CommandPalette() {
  const open = useUi((s) => s.commandPaletteOpen)
  const pending = useRef<PaletteRow | null>(null)
  /** Where focus was when the palette opened (a tree row, a field, a dialog's button…). */
  const returnFocus = useRef<HTMLElement | null>(null)

  // Recorded on the store change itself, before the palette renders and takes focus.
  useEffect(
    () =>
      useUi.subscribe((s, prev) => {
        if (!s.commandPaletteOpen || prev.commandPaletteOpen) return
        // Cross-language search needs every dictionary (loaded lazily, once).
        void ensureAllLanguages()
        const el = document.activeElement
        returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null
      }),
    [],
  )

  const flush = useCallback(() => {
    const row = pending.current
    pending.current = null
    if (row) performRow(row)
  }, [])

  const choose = useCallback(
    (row: PaletteRow) => {
      pending.current = row
      setCommandPaletteOpen(false)
      window.setTimeout(flush, RUN_FALLBACK_MS)
    },
    [flush],
  )

  // Radix would return focus to a Dialog.Trigger, which the palette does not have (it opens from
  // shortcuts, menus and the top bar), leaving it on <body>: put it back where it was instead.
  const onCloseAutoFocus = useCallback(
    (e: Event) => {
      e.preventDefault()
      const el = returnFocus.current
      returnFocus.current = null
      if (el?.isConnected) el.focus({ preventScroll: true })
      if (pending.current) window.setTimeout(flush, 0)
    },
    [flush],
  )

  return (
    <RadixDialog.Root open={open} onOpenChange={setCommandPaletteOpen}>
      {open && <PaletteDialog onChoose={choose} onCloseAutoFocus={onCloseAutoFocus} />}
    </RadixDialog.Root>
  )
}
