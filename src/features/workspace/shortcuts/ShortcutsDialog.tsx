/**
 * Keyboard shortcuts sheet (`?`, ⌘/): every shortcut by section, plus mouse gestures.
 * Searchable by command name or key; two columns on wide screens.
 */
import { Search, SearchX, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import { useCommands } from '@/commands/registry'
import { Dialog, EmptyState, TextInput } from '@/components/ui'
import { useT } from '@/i18n'
import { isMac } from '@/lib/platform'
import { GestureKeys, ShortcutKeys } from './Keys'
import { Highlight } from '../palette/Highlight'
import { buildSheet, filterSheet, type FilteredGroup } from './sheet'
import { useReturnFocus } from '../useReturnFocus'

function GroupView({ group }: { group: FilteredGroup }) {
  return (
    <section
      className="mb-6 break-inside-avoid"
      aria-label={group.title}
      data-testid={`shortcuts-group-${group.id}`}
    >
      <h3 className="mb-1 text-xs font-semibold text-fg">{group.title}</h3>
      <ul>
        {group.rows.map(({ row, positions }) => (
          <li
            key={row.id}
            className="flex min-h-7 items-center justify-between gap-4 border-b border-line-subtle py-1 last:border-b-0"
          >
            <span className="min-w-0 text-sm text-pretty text-fg-muted">
              <Highlight text={row.title} positions={positions} />
            </span>
            {row.kind === 'command' ? (
              <ShortcutKeys shortcuts={row.shortcuts} />
            ) : (
              <GestureKeys gesture={row.gesture} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ShortcutsDialog({ close }: DialogComponentProps) {
  const t = useT()
  useReturnFocus()
  const s = t.workspace.shortcuts
  const commands = useCommands()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const sheet = useMemo(() => buildSheet(commands.values(), t, isMac), [commands, t])
  const groups = useMemo(() => filterSheet(sheet, query), [sheet, query])

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      size="xl"
      title={s.title}
      footerStart={s.layoutNote}
      bodyClassName="flex flex-col overflow-hidden p-0"
    >
      <div className="shrink-0 px-5 pb-3">
        <TextInput
          ref={inputRef}
          autoFocus
          size="md"
          icon={Search}
          value={query}
          placeholder={s.search}
          aria-label={s.search}
          data-testid="shortcuts-search"
          onChange={(e) => setQuery(e.target.value)}
          suffix={
            query ? (
              <button
                type="button"
                aria-label={t.common.clear}
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                className="inline-flex size-5 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg"
              >
                <X size={12} />
              </button>
            ) : null
          }
        />
      </div>
      <div
        className="h-[min(64vh,600px)] overflow-y-auto border-t border-line px-5 pt-4 pb-2"
        data-testid="shortcuts-sheet"
      >
        {groups.length ? (
          <div className="gap-x-10 min-[1000px]:columns-2">
            {groups.map((group) => (
              <GroupView key={group.id} group={group} />
            ))}
          </div>
        ) : (
          <EmptyState icon={SearchX} title={s.empty(query.trim())} description={s.emptyHint} />
        )}
      </div>
    </Dialog>
  )
}
