import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useColorsUi } from './store'

/**
 * Quiet in-place confirmation (e.g. "Copied #FF6B4A") at the bottom of its container.
 * Not a toast: it appears where the action happened and disappears by itself.
 */
export function FlashMessage({ className }: { className?: string }) {
  const message = useColorsUi((s) => s.flash)
  if (!message) return null
  return (
    <output
      key={message.id}
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-2 z-10 flex animate-fade-in justify-center px-3',
        className,
      )}
    >
      <div className="flex h-6 max-w-full items-center gap-1.5 rounded-md bg-surface-3 px-2 text-xs text-fg shadow-popover">
        <Check size={12} className="shrink-0 text-success" />
        <span className="truncate">{message.text}</span>
      </div>
    </output>
  )
}
