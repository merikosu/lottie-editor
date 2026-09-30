/**
 * Transform of a layer (`ks`), a group (`tr` item) or a repeater (`tr` with start/end
 * opacity). Works on several nodes at once (multi-selection).
 */
import { ChevronRight } from 'lucide-react'
import { memo } from 'react'
import { Section } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { NodePath } from '@/lottie/path'
import type {
  PositionProperty,
  ScalarProperty as ScalarProp,
  SplitVectorProperty,
  Transform,
  VectorProperty,
} from '@/lottie/types'
import { isSplitPosition } from '@/lottie/types'
import { toggleSection, usePrefs } from '@/store/prefs'
import { ScaleProperty, ScalarProperty, VectorProperty as VectorField } from '../components/fields'
import { useNodesAt } from '../hooks'
import type { CompTime } from '../model/time'
import { isModified, pick, propTargets, staticProperty } from './common'

export type TransformKind = 'layer' | 'group' | 'repeater'

interface TransformSectionProps {
  /** Section id (collapsed state is remembered per id). */
  id: string
  title: string
  /**
   * Paths of the transform objects (e.g. [..., 'ks'] or a group's `tr` item). Pass a stable
   * array: the section is memoized and reads the transforms itself, so edits elsewhere in the
   * layer do not re-render it.
   */
  bases: NodePath[]
  times: CompTime[]
  kind: TransformKind
  /** 3D layers edit Z too. */
  threeD?: boolean
}

const MORE_ID = 'inspector.transform.more'

function subset<T>(list: T[], idx: number[]): T[] {
  return idx.map((i) => list[i])
}

export const TransformSection = memo(function TransformSection({
  id,
  title,
  bases,
  times,
  kind,
  threeD,
}: TransformSectionProps) {
  const t = useT()
  const transforms = useNodesAt<Transform>(bases)
  const p = t.inspector.props
  const dims = threeD ? 3 : 2
  // Layers store 3 components (x, y, z) for anchor/position/scale; groups store 2.
  const zero = kind === 'layer' ? [0, 0, 0] : [0, 0]
  const hundred = kind === 'layer' ? [100, 100, 100] : [100, 100]

  const hasSkew = transforms.some((tr) => isModified(tr?.sk, 0) || isModified(tr?.sa, 0))
  const moreOpen = usePrefs((s) => s.collapsedSections[MORE_ID] === false)
  const showSkew = hasSkew || moreOpen
  const hasOrientation = threeD && transforms.some((tr) => tr?.or || tr?.rx || tr?.ry)

  const split = transforms.map((tr) => isSplitPosition(tr?.p))
  const vectorIdx = bases.map((_, i) => i).filter((i) => !split[i])
  const splitIdx = bases.map((_, i) => i).filter((i) => split[i])

  const rotationKey = transforms.some((tr) => tr?.rz && !tr?.r) ? 'rz' : 'r'

  return (
    <Section id={id} title={title}>
      <VectorField
        label={p.anchor}
        targets={propTargets(bases, 'a', times, staticProperty(zero))}
        props={pick(transforms, (tr) => tr.a)}
        fallback={zero}
        dims={dims}
        resettable
      />
      {vectorIdx.length > 0 && (
        <VectorField
          label={p.position}
          targets={propTargets(
            subset(bases, vectorIdx),
            'p',
            subset(times, vectorIdx),
            staticProperty(zero),
          )}
          props={subset(transforms, vectorIdx).map((tr) => tr?.p as VectorProperty | undefined)}
          fallback={zero}
          dims={dims}
          resettable={kind !== 'layer'}
        />
      )}
      {splitIdx.length > 0 && (
        <SplitPosition
          bases={subset(bases, splitIdx)}
          positions={subset(transforms, splitIdx).map(
            (tr) => tr?.p as PositionProperty | undefined,
          )}
          times={subset(times, splitIdx)}
          threeD={threeD}
        />
      )}
      <ScaleProperty
        label={p.scale}
        targets={propTargets(bases, 's', times, staticProperty(hundred))}
        props={pick(transforms, (tr) => tr.s)}
        dims={dims}
        resettable
      />
      <ScalarProperty
        label={p.rotation}
        targets={propTargets(bases, rotationKey, times, staticProperty(0))}
        props={pick(transforms, (tr) => tr[rotationKey])}
        unit="°"
        precision={1}
        resettable
      />
      {hasOrientation && (
        <>
          <ScalarProperty
            label={p.rotationX}
            targets={propTargets(bases, 'rx', times, staticProperty(0))}
            props={pick(transforms, (tr) => tr.rx)}
            unit="°"
            resettable
          />
          <ScalarProperty
            label={p.rotationY}
            targets={propTargets(bases, 'ry', times, staticProperty(0))}
            props={pick(transforms, (tr) => tr.ry)}
            unit="°"
            resettable
          />
          <VectorField
            label={p.orientation}
            targets={propTargets(bases, 'or', times, staticProperty([0, 0, 0]))}
            props={pick(transforms, (tr) => tr.or)}
            fallback={[0, 0, 0]}
            dims={3}
            unit="°"
            resettable
          />
        </>
      )}
      {kind === 'repeater' ? (
        <>
          <ScalarProperty
            label={p.startOpacity}
            targets={propTargets(bases, 'so', times, staticProperty(100))}
            props={pick(transforms as (Transform & { so?: ScalarProp })[], (tr) => tr.so)}
            fallback={100}
            unit="%"
            precision={0}
            min={0}
            max={100}
            resettable
          />
          <ScalarProperty
            label={p.endOpacity}
            targets={propTargets(bases, 'eo', times, staticProperty(100))}
            props={pick(transforms as (Transform & { eo?: ScalarProp })[], (tr) => tr.eo)}
            fallback={100}
            unit="%"
            precision={0}
            min={0}
            max={100}
            resettable
          />
        </>
      ) : (
        <ScalarProperty
          label={p.opacity}
          targets={propTargets(bases, 'o', times, staticProperty(100))}
          props={pick(transforms, (tr) => tr.o)}
          fallback={100}
          unit="%"
          precision={0}
          min={0}
          max={100}
          resettable
        />
      )}
      {kind !== 'repeater' &&
        (showSkew ? (
          <>
            <ScalarProperty
              label={p.skew}
              targets={propTargets(bases, 'sk', times, staticProperty(0))}
              props={pick(transforms, (tr) => tr.sk)}
              unit="°"
              min={-85}
              max={85}
              resettable
            />
            <ScalarProperty
              label={p.skewAxis}
              targets={propTargets(bases, 'sa', times, staticProperty(0))}
              props={pick(transforms, (tr) => tr.sa)}
              unit="°"
              resettable
            />
            {!hasSkew && (
              <MoreToggle
                open
                onToggle={() => toggleSection(MORE_ID, true)}
                label={p.moreTransform}
              />
            )}
          </>
        ) : (
          <MoreToggle
            open={false}
            onToggle={() => toggleSection(MORE_ID, false)}
            label={p.moreTransform}
          />
        ))}
    </Section>
  )
})

/** Disclosure for rarely used transform fields (skew). */
function MoreToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-6 w-fit items-center gap-1 rounded-md pr-1.5 text-xs text-fg-subtle hover:text-fg-muted"
    >
      <span className="flex w-4 justify-center">
        <ChevronRight
          size={12}
          className={cn('transition-transform duration-100', open && 'rotate-90')}
        />
      </span>
      {label}
    </button>
  )
}

/** Separated dimensions: X and Y position are independent properties with their own keys. */
function SplitPosition({
  bases,
  positions,
  times,
  threeD,
}: {
  bases: NodePath[]
  positions: (PositionProperty | undefined)[]
  times: CompTime[]
  threeD?: boolean
}) {
  const t = useT()
  const split = positions as (SplitVectorProperty | undefined)[]
  const axes =
    threeD && split.some((p) => p?.z) ? (['x', 'y', 'z'] as const) : (['x', 'y'] as const)
  const labels = {
    x: t.inspector.props.positionX,
    y: t.inspector.props.positionY,
    z: t.inspector.props.positionZ,
  }
  return (
    <>
      {axes.map((axis) => (
        <ScalarProperty
          key={axis}
          label={labels[axis]}
          targets={propTargets(bases, ['p', axis], times, staticProperty(0))}
          props={split.map((p) => p?.[axis])}
          precision={1}
        />
      ))}
    </>
  )
}
