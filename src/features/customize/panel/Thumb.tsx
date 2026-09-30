import type { ComponentType, CSSProperties } from 'react'
import type { IconProps } from '@/commands/registry'
import { cn } from '@/lib/cn'
import { usePrefs } from '@/store/prefs'

const CHECKER: CSSProperties = {
  backgroundColor: 'var(--le-checker-a)',
  backgroundImage:
    'linear-gradient(45deg, var(--le-checker-b) 25%, transparent 25%), linear-gradient(-45deg, var(--le-checker-b) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--le-checker-b) 75%), linear-gradient(-45deg, transparent 75%, var(--le-checker-b) 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
}

/** Background of thumbnails: the same as the preview's, so elements look as they do there. */
function useTileBackground(): CSSProperties {
  const mode = usePrefs((s) => s.canvasBackground)
  const custom = usePrefs((s) => s.canvasColor)
  if (mode === 'dark') return { background: '#1b1c1f' }
  if (mode === 'light') return { background: '#ffffff' }
  if (mode === 'custom') return { background: custom }
  return CHECKER
}

/** Square thumbnail tile: an image, or a quiet icon while there is none. */
export function Thumb({
  src,
  icon: Icon,
  size = 36,
  className,
}: {
  src?: string
  icon: ComponentType<IconProps>
  size?: number
  className?: string
}) {
  const background = useTileBackground()
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--le-line)]',
        className,
      )}
      style={{ width: size, height: size, ...(src ? background : null) }}
    >
      {src ? (
        <img src={src} alt="" draggable={false} className="size-full object-contain" />
      ) : (
        <span className="flex size-full items-center justify-center bg-surface-2">
          <Icon size={14} className="text-fg-faint" />
        </span>
      )}
    </span>
  )
}
