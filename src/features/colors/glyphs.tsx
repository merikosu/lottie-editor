/**
 * Glyphs lucide does not have, drawn on lucide's 24px grid so they sit well next to its icons.
 */
import { useId } from 'react'
import type { IconProps } from '@/commands/registry'
import { cn } from '@/lib/cn'

/** A swatch ramping from solid to clear: "used in a gradient". */
export function GradientGlyph({ size = 24, className, strokeWidth }: IconProps) {
  // useId output may contain characters that are awkward inside url(#…).
  const id = `le-gradient-glyph-${useId().replace(/[^\w-]/g, '')}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 2}
      strokeLinejoin="round"
      className={cn('lucide', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0.1" stopColor="currentColor" />
          <stop offset="0.95" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="2" fill={`url(#${id})`} stroke="none" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  )
}
