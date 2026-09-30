import { X } from 'lucide-react'
import { Dialog as RadixDialog } from 'radix-ui'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useT } from '@/i18n'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

const widths: Record<DialogSize, string> = {
  sm: 'w-[400px]',
  md: 'w-[520px]',
  lg: 'w-[720px]',
  xl: 'w-[960px]',
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  size?: DialogSize
  /** Footer content (usually buttons, right-aligned). */
  footer?: ReactNode
  /** Extra content in the footer's left side (hints, secondary actions). */
  footerStart?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  /** Prevent closing on outside click (e.g. during long operations). */
  dismissable?: boolean
  /** Control initial focus (call `e.preventDefault()` and focus your own element). */
  onOpenAutoFocus?: (e: Event) => void
}

/**
 * Modal dialog: title, optional description, scrollable body and a footer with actions.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  footer,
  footerStart,
  children,
  className,
  bodyClassName,
  dismissable = true,
  onOpenAutoFocus,
}: DialogProps) {
  const t = useT()
  // App dialogs open through openDialog() without a Radix trigger, so remember what had focus
  // and give it back on close (Radix would otherwise focus <body>).
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (
      open &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
    ) {
      returnFocus.current = document.activeElement
    }
  }, [open])
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(o) => (dismissable || o ? onOpenChange(o) : undefined)}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/50" />
        <RadixDialog.Content
          data-modal-dialog=""
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={(e) => {
            const el = returnFocus.current
            returnFocus.current = null
            if (el?.isConnected) {
              e.preventDefault()
              el.focus({ preventScroll: true })
            }
          }}
          onPointerDownOutside={(e) => !dismissable && e.preventDefault()}
          onEscapeKeyDown={(e) => !dismissable && e.preventDefault()}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[min(88vh,860px)] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-dialog-in flex-col rounded-xl bg-surface-1 text-fg shadow-dialog outline-none',
            widths[size],
            className,
          )}
        >
          <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-md font-semibold text-fg">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm text-fg-muted">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">
                  {typeof title === 'string' ? title : ''}
                </RadixDialog.Description>
              )}
            </div>
            {dismissable && (
              <RadixDialog.Close
                aria-label={t.common.close}
                className="-mt-0.5 -mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
              >
                <X size={16} />
              </RadixDialog.Close>
            )}
          </div>
          {children !== undefined && (
            <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 pb-5', bodyClassName)}>
              {children}
            </div>
          )}
          {(footer || footerStart) && (
            <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-fg-subtle">
                {footerStart}
              </div>
              <div className="flex shrink-0 items-center gap-2">{footer}</div>
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
