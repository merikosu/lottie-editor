/**
 * Format list on the left of the export dialog: grouped, icon + name + one-line hint. Native
 * radio inputs give arrow-key navigation and screen reader semantics for free; unavailable
 * formats stay selectable so their options can explain why.
 */
import { useId } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { FORMATS, GROUPS } from '../formats'
import type { ExportFormat } from '../store'

interface FormatListProps {
  value: ExportFormat
  onChange: (format: ExportFormat) => void
  /** Formats this browser cannot produce. */
  unavailable: ReadonlySet<ExportFormat>
  disabled?: boolean
}

export function FormatList({ value, onChange, unavailable, disabled }: FormatListProps) {
  const t = useT()
  const name = useId()
  return (
    <fieldset
      disabled={disabled}
      className={cn('m-0 flex min-w-0 flex-col gap-3 border-0 px-2 py-3', disabled && 'opacity-60')}
      data-testid="export-format-list"
    >
      <legend className="sr-only">{t.export.title}</legend>
      {GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-px" role="presentation">
          <div className="px-2 pb-1 text-xs font-medium text-fg-subtle" aria-hidden>
            {t.export.groups[group.id]}
          </div>
          {group.formats.map((id) => {
            const Icon = FORMATS[id].icon
            const selected = id === value
            const off = unavailable.has(id)
            return (
              <label
                key={id}
                data-testid={`export-format-${id}`}
                data-selected={selected || undefined}
                className={cn(
                  'group relative flex h-[38px] w-full items-center gap-2.5 rounded-md px-2 transition-colors duration-100',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-1 has-[:focus-visible]:outline-accent',
                  selected ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={id}
                  checked={selected}
                  onChange={() => onChange(id)}
                  className="sr-only"
                />
                <Icon
                  size={16}
                  aria-hidden
                  className={cn(
                    'shrink-0',
                    off
                      ? 'text-fg-faint'
                      : selected
                        ? 'text-accent-text'
                        : 'text-fg-muted group-hover:text-fg',
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      'truncate text-sm leading-4 font-medium',
                      off ? 'text-fg-subtle' : 'text-fg',
                    )}
                  >
                    {t.export.formats[id].name}
                  </span>
                  <span className="truncate text-xs leading-4 text-fg-subtle">
                    {off ? t.export.notAvailable : t.export.formats[id].hint}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      ))}
    </fieldset>
  )
}
