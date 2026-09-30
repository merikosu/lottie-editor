import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
} from 'lucide-react'
import { useId, useRef, type ComponentType, type KeyboardEvent } from 'react'
import type { IconProps } from '@/commands/registry'
import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { ANCHORS, type Anchor } from '@/lottie/canvas'

const ARROWS: Record<string, ComponentType<IconProps>> = {
  '0,-1': ArrowUp,
  '0,1': ArrowDown,
  '-1,0': ArrowLeft,
  '1,0': ArrowRight,
  '-1,-1': ArrowUpLeft,
  '1,-1': ArrowUpRight,
  '-1,1': ArrowDownLeft,
  '1,1': ArrowDownRight,
}

const KEY_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

interface AnchorPickerProps {
  value: Anchor
  onChange: (anchor: Anchor) => void
  /**
   * How the canvas changes per axis (1 grows, −1 shrinks, 0 same): the cells around the
   * anchor show arrows in that direction, like Photoshop's canvas size anchor.
   */
  growth?: { x: number; y: number }
  disabled?: boolean
  className?: string
}

/** 3 × 3 anchor grid: native radio buttons with two-dimensional arrow-key navigation. */
export function AnchorPicker({
  value,
  onChange,
  growth = { x: 0, y: 0 },
  disabled,
  className,
}: AnchorPickerProps) {
  const t = useT()
  const name = useId()
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const selected = Math.max(0, ANCHORS.indexOf(value))
  const col = selected % 3
  const row = Math.floor(selected / 3)

  // Native radios move linearly; a grid wants up/down to change rows.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = KEY_STEPS[e.key]
    if (!step) return
    e.preventDefault()
    const c = Math.min(2, Math.max(0, col + step[0]))
    const r = Math.min(2, Math.max(0, row + step[1]))
    const index = r * 3 + c
    onChange(ANCHORS[index])
    inputs.current[index]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t.docops.canvas.anchor}
      aria-disabled={disabled || undefined}
      data-testid="docops-anchor"
      className={cn(
        'grid w-fit shrink-0 grid-cols-3 gap-px rounded-md bg-surface-2 p-0.5 shadow-[inset_0_0_0_1px_var(--le-line)]',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      {ANCHORS.map((anchor, index) => {
        const isSelected = index === selected
        const dx = (index % 3) - col
        const dy = Math.floor(index / 3) - row
        const gx = Math.sign(growth.x)
        const gy = Math.sign(growth.y)
        // Arrows only on neighbours lying along axes that change size.
        const along =
          Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx === 0 || gx !== 0) && (dy === 0 || gy !== 0)
        const Icon = along ? ARROWS[`${dx * gx},${dy * gy}`] : undefined
        return (
          <Tooltip key={anchor} content={t.docops.canvas.anchors[anchor]}>
            <label
              className={cn(
                'group flex size-4 items-center justify-center rounded-xs text-fg-subtle transition-colors duration-100 hover:bg-hover hover:text-fg',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-solid',
              )}
            >
              <input
                ref={(el) => {
                  inputs.current[index] = el
                }}
                type="radio"
                name={name}
                value={anchor}
                checked={isSelected}
                disabled={disabled}
                aria-label={t.docops.canvas.anchors[anchor]}
                onChange={() => onChange(anchor)}
                onKeyDown={onKeyDown}
                className="sr-only"
              />
              {isSelected ? (
                <span className="block size-2 rounded-[2px] bg-accent" />
              ) : Icon ? (
                <Icon size={10} strokeWidth={2} />
              ) : (
                <span className="block size-[3px] rounded-full bg-fg-faint group-hover:bg-fg-subtle" />
              )}
            </label>
          </Tooltip>
        )
      })}
    </div>
  )
}
