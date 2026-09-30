/**
 * Layout pieces of the settings dialog: sections separated by hairlines, and rows with the
 * label and explanation on the left and the control on the right.
 */
import { useState, type ReactNode } from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 pt-3 pb-2 last:border-b-0" aria-label={title}>
      {title && <h3 className="pb-1 text-xs font-semibold text-fg">{title}</h3>}
      {children}
    </section>
  )
}

interface SettingRowProps {
  label: ReactNode
  /** Explanation under the label. */
  hint?: ReactNode
  /** id of the control, so clicking the label focuses/toggles it. */
  htmlFor?: string
  control: ReactNode
  className?: string
  testId?: string
}

export function SettingRow({ label, hint, htmlFor, control, className, testId }: SettingRowProps) {
  return (
    <div
      className={cn('flex items-start justify-between gap-6 py-2', className)}
      data-testid={testId}
    >
      <div className="min-w-0 flex-1 pt-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm text-fg">
            {label}
          </label>
        ) : (
          <div className="text-sm text-fg">{label}</div>
        )}
        {hint && <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div>}
      </div>
      <div className="flex min-h-6 shrink-0 items-center">{control}</div>
    </div>
  )
}

interface ConfirmButtonProps {
  label: string
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  variant?: 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  /** Popover alignment to the button. */
  align?: 'start' | 'end'
  testId?: string
}

/**
 * A button that asks for confirmation in a small popover (no second modal on top of the
 * dialog). Cancel gets the focus, so Enter never destroys data by accident.
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  variant = 'secondary',
  size = 'sm',
  align = 'end',
  testId,
}: ConfirmButtonProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size={size} variant={variant} disabled={disabled} data-testid={testId}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align={align} className="w-72 p-3">
        <div className="text-sm font-medium text-fg">{title}</div>
        <p className="mt-1 text-xs text-fg-muted">{description}</p>
        <div className="mt-3 flex justify-end gap-2">
          {/* First in order: Radix focuses it when the popover opens. */}
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="danger"
            data-testid={testId ? `${testId}-confirm` : undefined}
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
