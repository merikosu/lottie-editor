/**
 * Masks of a layer: mode, inverted, opacity, expansion and path info. (Effects live in
 * `effects/EffectsSection.tsx`.)
 */
import {
  CircleOff,
  Contrast,
  Moon,
  SquaresExclude,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  Sun,
} from 'lucide-react'
import { memo } from 'react'
import { Badge, IconButton, Section, type SelectOption } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { getAt, type NodePath } from '@/lottie/path'
import { evaluatePath, isAnimated } from '@/lottie/property'
import type { Mask, MaskMode } from '@/lottie/types'
import { updateDoc } from '@/store/document'
import { ScalarProperty } from '../components/fields'
import { SelectRow } from '../components/plain'
import { CountTitle, InspectorRow, SubHeader } from '../components/Row'
import { useNodesAt } from '../hooks'
import { nameText } from '../model/names'
import type { CompTime } from '../model/time'
import { propTargets, staticProperty } from './common'

const MASK_MODES: MaskMode[] = ['a', 's', 'i', 'l', 'd', 'f', 'n']

const MASK_ICONS = {
  a: SquaresUnite,
  s: SquaresSubtract,
  i: SquaresIntersect,
  l: Sun,
  d: Moon,
  f: SquaresExclude,
  n: CircleOff,
} as const

function editMask(label: string, layerPath: NodePath, index: number, fn: (mask: Mask) => void) {
  updateDoc(label, (draft) => {
    const mask = getAt<Mask>(draft, [...layerPath, 'masksProperties', index])
    if (mask) fn(mask)
  })
}

/** Masks of one layer (memoized: pass a stable `path`; the masks are read here). */
export const MasksSection = memo(function MasksSection({
  path,
  time,
}: {
  path: NodePath
  time: CompTime
}) {
  const t = useT()
  const tm = t.inspector.masks
  const [stored] = useNodesAt<Mask[]>([[...path, 'masksProperties']])
  const masks = Array.isArray(stored) ? stored : []
  if (masks.length === 0) return null

  const modeOptions: SelectOption<MaskMode>[] = MASK_MODES.map((m) => ({
    value: m,
    label: tm.modes[m],
    icon: MASK_ICONS[m],
  }))

  return (
    <Section
      id="inspector.masks"
      title={<CountTitle title={t.inspector.sections.masks} count={masks.length} />}
    >
      {masks.map((mask, i) => {
        const base: NodePath = [...path, 'masksProperties', i]
        const shape = evaluatePath(mask.pt, time.frame)
        const vertices = shape?.v?.length ?? 0
        return (
          <div key={i} className={cn('flex flex-col gap-1.5', i > 0 && 'pt-1.5')}>
            <SubHeader
              actions={
                <IconButton
                  icon={Contrast}
                  size="sm"
                  label={tm.invert}
                  active={!!mask.inv}
                  tooltipSide="left"
                  onClick={() =>
                    editMask(t.inspector.history.mask, path, i, (m) => void (m.inv = !m.inv))
                  }
                />
              }
            >
              <span className="pl-5">{nameText(mask.nm) || tm.mask(i + 1)}</span>
            </SubHeader>
            <SelectRow<MaskMode>
              label={tm.mode}
              value={mask.mode ?? 'a'}
              options={modeOptions}
              onChange={(mode) =>
                editMask(t.inspector.history.mask, path, i, (m) => void (m.mode = mode))
              }
            />
            <ScalarProperty
              label={tm.opacity}
              targets={propTargets([base], 'o', [time], staticProperty(100))}
              props={[mask.o]}
              fallback={100}
              unit="%"
              precision={0}
              min={0}
              max={100}
              resettable
            />
            <ScalarProperty
              label={tm.expansion}
              targets={propTargets([base], 'x', [time], staticProperty(0))}
              props={[mask.x]}
              fallback={0}
              unit="px"
              precision={1}
              resettable
            />
            <InspectorRow label={tm.path}>
              <span className="min-w-0 truncate text-sm text-fg-muted tabular-nums">
                {t.inspector.props.vertices(vertices)},{' '}
                {shape?.c === false ? t.inspector.props.open : t.inspector.props.closed}
              </span>
              {isAnimated(mask.pt) && <Badge tone="accent">{t.inspector.props.animatedPath}</Badge>}
            </InspectorRow>
          </div>
        )
      })}
    </Section>
  )
})
