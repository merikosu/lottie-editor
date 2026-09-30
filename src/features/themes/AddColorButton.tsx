/**
 * "Add color": a popover with the animation's colors that can become theme colors (static fill,
 * stroke, text animator, effect and layer style colors). Picking one binds every such use of it.
 */
import { Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import {
  Button,
  ColorSwatch,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  type ButtonProps,
} from '@/components/ui'
import { useT } from '@/i18n'
import { extractColorUsages, groupColors, type ColorGroup } from '@/lottie/colors'
import { planColorBinding } from '@/lottie/slots'
import type { Animation } from '@/lottie/types'
import { setHighlightNodes } from '@/store/ui'
import { useDocument } from '@/store/document'
import { makeThemeColor } from './actions'

interface Candidate {
  group: ColorGroup
  uses: number
}

/** Color groups with at least one property that can join a new theme color. */
function candidates(doc: Animation): { list: Candidate[]; skipped: boolean } {
  const groups = groupColors(extractColorUsages(doc))
  const list: Candidate[] = []
  let skipped = false
  for (const group of groups) {
    const plan = planColorBinding(doc, group.usages)
    if (Object.keys(plan.skipped).length > 0) skipped = true
    if (plan.paths.length > 0 && !plan.allBound) list.push({ group, uses: plan.paths.length })
  }
  return { list, skipped }
}

interface AddColorButtonProps {
  label: string
  variant?: ButtonProps['variant']
}

export function AddColorButton({ label, variant = 'ghost' }: AddColorButtonProps) {
  const [open, setOpen] = useState(false)
  // After a pick, focus goes to the new color's name field, not back to this button.
  const picked = useRef(false)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) picked.current = false
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          icon={Plus}
          className={variant === 'ghost' ? '-ml-1.5 self-start' : 'self-start'}
          data-testid="themes-add-color"
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="w-[256px]"
        onCloseAutoFocus={(e) => {
          if (picked.current) e.preventDefault()
        }}
      >
        {open && (
          <Palette
            onPick={() => {
              picked.current = true
              setOpen(false)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function Palette({ onPick }: { onPick: () => void }) {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const { list, skipped } = useMemo(
    () => (doc ? candidates(doc) : { list: [], skipped: false }),
    [doc],
  )
  return (
    <div className="flex flex-col gap-2" data-testid="themes-palette">
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-medium text-fg">{t.themes.picker.title}</div>
        <div className="text-xs text-fg-subtle">{t.themes.picker.hint}</div>
      </div>
      {list.length === 0 ? (
        <div className="text-xs text-fg-muted">{t.themes.picker.none}</div>
      ) : (
        <div className="grid grid-cols-8 gap-1.5" onPointerLeave={() => setHighlightNodes([])}>
          {list.map(({ group, uses }) => (
            <Tooltip
              key={group.key}
              content={t.themes.picker.swatch(group.hex.toUpperCase(), t.themes.picker.uses(uses))}
              side="top"
            >
              <button
                type="button"
                aria-label={group.hex.toUpperCase()}
                className="rounded-sm outline-offset-1 transition-shadow duration-100 hover:shadow-[0_0_0_1.5px_var(--le-surface-3),0_0_0_3px_var(--le-line-strong)]"
                onPointerEnter={() =>
                  setHighlightNodes([...new Set(group.usages.map((u) => u.layerPath))])
                }
                onClick={() => {
                  onPick()
                  setHighlightNodes([])
                  makeThemeColor(group.usages, false)
                }}
              >
                <ColorSwatch color={group.hex} size={22} className="rounded-sm" />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
      {skipped && <div className="text-xs text-fg-faint">{t.themes.picker.unsupported}</div>}
    </div>
  )
}
