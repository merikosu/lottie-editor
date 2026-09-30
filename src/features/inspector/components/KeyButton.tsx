/**
 * Keyframe status button (Rive / Glaxnimate convention):
 *  ◇ not animated · ◈ animated, no key at the playhead · ◆ key at the playhead.
 */
import { Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { KeyStatus } from '../edit'

interface KeyButtonProps {
  status: KeyStatus
  onClick: () => void
  tooltip: string
  disabled?: boolean
}

export function KeyButton({ status, onClick, tooltip, disabled }: KeyButtonProps) {
  return (
    <Tooltip content={tooltip} side="left">
      <button
        type="button"
        aria-label={tooltip}
        aria-pressed={status === 'key'}
        disabled={disabled}
        onClick={onClick}
        data-status={status}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-xs transition-colors duration-100 disabled:opacity-30',
          status === 'static' && 'text-fg-faint hover:text-fg-muted',
          status === 'animated' && 'text-accent-text hover:text-accent',
          status === 'key' && 'text-accent hover:text-accent-hover',
        )}
      >
        <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
          <path
            d="M5 0.85 9.15 5 5 9.15 0.85 5Z"
            fill={status === 'key' ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          {status === 'animated' && <path d="M5 3.4 6.6 5 5 6.6 3.4 5Z" fill="currentColor" />}
        </svg>
      </button>
    </Tooltip>
  )
}
