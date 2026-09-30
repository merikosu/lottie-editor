/**
 * In-place name editor for theme colors and themes: Enter commits, Escape cancels, blurring
 * commits a valid name and cancels an invalid one. A problem is shown under the field.
 */
import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

interface InlineRenameProps {
  value: string
  placeholder?: string
  /** Returns a message when the name cannot be used, otherwise null. */
  validate?: (name: string) => string | null
  /** Committing the name as it is counts (naming something new); otherwise it cancels. */
  commitUnchanged?: boolean
  onCommit: (name: string) => void
  onCancel: () => void
  className?: string
  inputClassName?: string
  'aria-label': string
}

export function InlineRename({
  value,
  placeholder,
  validate,
  commitUnchanged,
  onCommit,
  onCancel,
  className,
  inputClassName,
  ...rest
}: InlineRenameProps) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  // Enter commits and unmounts the field, which blurs it: finish only once.
  const finished = useRef(false)

  const finish = (fn: () => void) => {
    if (finished.current) return
    finished.current = true
    fn()
  }

  /** Commits the draft; returns false when it is not a valid name. */
  const commit = (): boolean => {
    const name = draft.trim()
    if (name === value.trim() && name && !commitUnchanged) {
      finish(onCancel)
      return true
    }
    const problem = validate?.(name) ?? null
    if (problem) {
      setError(problem)
      return false
    }
    finish(() => onCommit(name))
    return true
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(onCancel)
    }
    // Keys typed here never reach list navigation or global shortcuts.
    e.stopPropagation()
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <input
        autoFocus
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-label={rest['aria-label']}
        aria-invalid={error ? true : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!commit()) finish(onCancel)
        }}
        className={cn(
          'h-6 w-full min-w-0 rounded-sm bg-surface-2 px-1.5 text-sm text-fg shadow-[inset_0_0_0_1px_var(--le-accent)] outline-none placeholder:text-fg-faint',
          error && 'shadow-[inset_0_0_0_1px_var(--le-danger)]',
          inputClassName,
        )}
      />
      {error && (
        <div
          role="alert"
          className="absolute top-full left-0 z-10 mt-1 animate-fade-in rounded-md bg-surface-3 px-2 py-1 text-xs whitespace-nowrap text-danger shadow-popover"
        >
          {error}
        </div>
      )}
    </div>
  )
}
