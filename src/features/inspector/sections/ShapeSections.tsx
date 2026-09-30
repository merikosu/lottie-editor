/**
 * Sections for shape items (fills, strokes, gradients, geometry and modifiers). Each takes
 * one or more items of the same type so a multi-selection edits them together.
 */
import { ArrowLeftRight, Hexagon, Info, Minus, Plus, Star as StarIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Badge, IconButton, Section, Select, type ChangeGesture } from '@/components/ui'
import { useT } from '@/i18n'
import { getAt, type NodePath } from '@/lottie/path'
import { evaluatePath, isAnimated } from '@/lottie/property'
import type {
  EllipseShape,
  FillShape,
  GradientFillShape,
  GradientStrokeShape,
  GroupShape,
  MergeShape,
  OffsetPathShape,
  PathShape,
  PuckerBloatShape,
  RectShape,
  RepeaterShape,
  RoundCornersShape,
  StarShape,
  StrokeDash,
  StrokeShape,
  TrimShape,
  TwistShape,
  ZigZagShape,
} from '@/lottie/types'
import { updateDoc, useDocument } from '@/store/document'
import { ColorProperty, ScalarProperty, VectorProperty } from '../components/fields'
import {
  CapButtIcon,
  CapRoundIcon,
  CapSquareIcon,
  JoinBevelIcon,
  JoinMiterIcon,
  JoinRoundIcon,
} from '../components/icons'
import { IconSegmented, type IconSegment } from '../components/IconSegmented'
import { NumberRow, SegmentRow, SelectRow } from '../components/plain'
import { gestureOptions } from '../edit'
import { InspectorRow, Note, SubHeader } from '../components/Row'
import { reverseGradient } from './gradient-edit'
import { GradientStopsRow } from './GradientStops'
import type { CompTime } from '../model/time'
import { commonValue, usesLegacyColorScale } from '../model/values'
import { pick, propTargets, staticProperty } from './common'
import { TransformSection } from './TransformSection'
import { AppearanceSection } from './AppearanceSection'

interface ItemsProps<T> {
  paths: NodePath[]
  items: T[]
  times: CompTime[]
}

/** Edits every item in one undo step. */
function editItems<T>(
  label: string,
  paths: NodePath[],
  fn: (item: T) => void,
  gesture?: ChangeGesture,
) {
  updateDoc(
    label,
    (draft) => {
      for (const p of paths) {
        const item = getAt<T>(draft, p)
        if (item) fn(item)
      }
    },
    gestureOptions(gesture),
  )
}

function useLegacyColors(): boolean {
  return useDocument((s) => usesLegacyColorScale(s.doc?.v))
}

/* -------------------------------------------------------------------------- */
/*                                Fill / stroke                               */
/* -------------------------------------------------------------------------- */

function FillRuleRow({
  paths,
  items,
}: {
  paths: NodePath[]
  items: (FillShape | GradientFillShape)[]
}) {
  const t = useT()
  const p = t.inspector.props
  const rule = commonValue(items.map((i) => (i.r === 2 ? '2' : '1')))
  return (
    <SelectRow<'1' | '2'>
      label={p.fillRule}
      hint={p.fillRuleHint}
      value={rule}
      options={[
        { value: '1', label: p.nonZero },
        { value: '2', label: p.evenOdd },
      ]}
      onChange={(v) =>
        editItems<FillShape>(
          t.inspector.history.change(p.fillRule),
          paths,
          (i) => void (i.r = v === '2' ? 2 : 1),
        )
      }
    />
  )
}

export function FillSection({ paths, items, times }: ItemsProps<FillShape>) {
  const t = useT()
  const p = t.inspector.props
  const legacy = useLegacyColors()
  return (
    <Section id="inspector.fill" title={t.common.shapeTypes.fl}>
      <ColorProperty
        label={p.color}
        targets={propTargets(paths, 'c', times, staticProperty([0, 0, 0, 1]))}
        props={pick(items, (i) => i.c)}
        legacyScale={legacy}
      />
      <ScalarProperty
        label={p.opacity}
        targets={propTargets(paths, 'o', times, staticProperty(100))}
        props={pick(items, (i) => i.o)}
        fallback={100}
        unit="%"
        precision={0}
        min={0}
        max={100}
        resettable
      />
      <FillRuleRow paths={paths} items={items} />
    </Section>
  )
}

type Cap = '1' | '2' | '3'
type Join = '1' | '2' | '3'

/** Width, caps, joins, miter limit and dashes (shared by strokes and gradient strokes). */
function StrokeStyle({ paths, items, times }: ItemsProps<StrokeShape | GradientStrokeShape>) {
  const t = useT()
  const p = t.inspector.props
  const history = t.inspector.history
  // lottie-web draws a missing cap/join as round.
  const cap = commonValue(items.map((i) => String(i.lc ?? 2) as Cap))
  const join = commonValue(items.map((i) => String(i.lj ?? 2) as Join))
  const capOptions: IconSegment<Cap>[] = [
    { value: '1', icon: CapButtIcon, title: p.capButt },
    { value: '2', icon: CapRoundIcon, title: p.capRound },
    { value: '3', icon: CapSquareIcon, title: p.capSquare },
  ]
  const joinOptions: IconSegment<Join>[] = [
    { value: '1', icon: JoinMiterIcon, title: p.joinMiter },
    { value: '2', icon: JoinRoundIcon, title: p.joinRound },
    { value: '3', icon: JoinBevelIcon, title: p.joinBevel },
  ]
  const animatedMiter = items.some((i) => i.ml2)
  return (
    <>
      <ScalarProperty
        label={p.width}
        targets={propTargets(paths, 'w', times, staticProperty(1))}
        props={pick(items, (i) => i.w)}
        fallback={1}
        unit="px"
        precision={1}
        min={0}
        step={0.5}
      />
      <InspectorRow label={p.lineCap}>
        <IconSegmented
          value={cap}
          options={capOptions}
          label={p.lineCap}
          onChange={(v) =>
            editItems<StrokeShape>(
              history.change(p.lineCap),
              paths,
              (i) => void (i.lc = Number(v) as 1 | 2 | 3),
            )
          }
        />
      </InspectorRow>
      <InspectorRow label={p.lineJoin}>
        <IconSegmented
          value={join}
          options={joinOptions}
          label={p.lineJoin}
          onChange={(v) =>
            editItems<StrokeShape>(
              history.change(p.lineJoin),
              paths,
              (i) => void (i.lj = Number(v) as 1 | 2 | 3),
            )
          }
        />
      </InspectorRow>
      {join === '1' &&
        (animatedMiter ? (
          <ScalarProperty
            label={p.miterLimit}
            targets={propTargets(paths, 'ml2', times, staticProperty(4))}
            props={pick(items, (i) => i.ml2)}
            fallback={4}
            precision={1}
            min={1}
          />
        ) : (
          <NumberRow
            label={p.miterLimit}
            value={commonValue(items.map((i) => i.ml ?? 4))}
            precision={1}
            min={1}
            step={0.5}
            onChange={(v, g) =>
              editItems<StrokeShape>(history.change(p.miterLimit), paths, (i) => void (i.ml = v), g)
            }
          />
        ))}
      {paths.length === 1 && <Dashes path={paths[0]} dashes={items[0].d} time={times[0]} />}
    </>
  )
}

export function StrokeSection({ paths, items, times }: ItemsProps<StrokeShape>) {
  const t = useT()
  const p = t.inspector.props
  const legacy = useLegacyColors()
  return (
    <Section id="inspector.stroke" title={t.common.shapeTypes.st}>
      <ColorProperty
        label={p.color}
        targets={propTargets(paths, 'c', times, staticProperty([0, 0, 0, 1]))}
        props={pick(items, (i) => i.c)}
        legacyScale={legacy}
      />
      <ScalarProperty
        label={p.opacity}
        targets={propTargets(paths, 'o', times, staticProperty(100))}
        props={pick(items, (i) => i.o)}
        fallback={100}
        unit="%"
        precision={0}
        min={0}
        max={100}
        resettable
      />
      <StrokeStyle paths={paths} items={items} times={times} />
    </Section>
  )
}

/* ---------------------------------- Dashes --------------------------------- */

function Dashes({
  path,
  dashes,
  time,
}: {
  path: NodePath
  dashes: StrokeDash[] | undefined
  time: CompTime
}) {
  const t = useT()
  const p = t.inspector.props
  const list = Array.isArray(dashes) ? dashes : []
  const pairs = list.filter((d) => d.n === 'd').length

  const add = () =>
    updateDoc(t.inspector.history.addDash, (draft) => {
      const item = getAt<StrokeShape>(draft, path)
      if (!item) return
      const d = Array.isArray(item.d) ? item.d : []
      const offsetIndex = d.findIndex((x) => x.n === 'o')
      const pair: StrokeDash[] = [
        { n: 'd', nm: 'dash', v: { a: 0, k: 10 } },
        { n: 'g', nm: 'gap', v: { a: 0, k: 10 } },
      ]
      if (offsetIndex >= 0) d.splice(offsetIndex, 0, ...pair)
      else d.push(...pair, { n: 'o', nm: 'offset', v: { a: 0, k: 0 } })
      item.d = d
    })

  const remove = () =>
    updateDoc(t.inspector.history.removeDash, (draft) => {
      const item = getAt<StrokeShape>(draft, path)
      if (!item?.d) return
      const lastDash = item.d.map((x) => x.n).lastIndexOf('d')
      if (lastDash < 0) return
      const gap = item.d[lastDash + 1]?.n === 'g' ? 1 : 0
      item.d.splice(lastDash, 1 + gap)
      if (!item.d.some((x) => x.n === 'd')) delete item.d
    })

  let dashNo = 0
  let gapNo = 0
  return (
    <>
      <SubHeader
        actions={
          <>
            {pairs > 0 && (
              <IconButton icon={Minus} label={p.removeDash} onClick={remove} tooltipSide="left" />
            )}
            <IconButton icon={Plus} label={p.addDash} onClick={add} tooltipSide="left" />
          </>
        }
      >
        <span className="pl-5">{p.dashes}</span>
        {pairs === 0 && <span className="ml-1.5 font-normal text-fg-subtle">{p.noDashes}</span>}
      </SubHeader>
      {list.map((entry, i) => {
        const n = entry.n === 'd' ? ++dashNo : entry.n === 'g' ? ++gapNo : 0
        const base = entry.n === 'd' ? p.dash : entry.n === 'g' ? p.gap : p.dashOffset
        const label = entry.n !== 'o' && pairs > 1 ? `${base} ${n}` : base
        return (
          <ScalarProperty
            key={i}
            label={label}
            targets={propTargets([path], ['d', i, 'v'], [time], staticProperty(0))}
            props={[entry.v]}
            unit="px"
            precision={1}
            min={entry.n === 'o' ? undefined : 0}
          />
        )
      })}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Gradients                                 */
/* -------------------------------------------------------------------------- */

export function GradientSection({
  paths,
  items,
  times,
}: ItemsProps<GradientFillShape | GradientStrokeShape>) {
  const t = useT()
  const p = t.inspector.props
  const history = t.inspector.history
  const stroke = items[0].ty === 'gs'
  const type = commonValue(items.map((i) => (i.t === 2 ? '2' : '1')))
  const radial = items.some((i) => i.t === 2)
  const single = paths.length === 1

  return (
    <Section
      id={stroke ? 'inspector.gradientStroke' : 'inspector.gradientFill'}
      title={t.common.shapeTypes[stroke ? 'gs' : 'gf']}
    >
      <InspectorRow label={p.gradientType}>
        <div className="min-w-0 flex-1">
          <Select<'1' | '2'>
            value={type ?? undefined}
            placeholder={type === null ? t.common.mixed : undefined}
            onValueChange={(v) =>
              editItems<GradientFillShape>(history.gradientType, paths, (i) => {
                i.t = v === '2' ? 2 : 1
                // Radial gradients need highlight properties (lottie-web reads them).
                if (i.t === 2) {
                  i.h ??= { a: 0, k: 0 }
                  i.a ??= { a: 0, k: 0 }
                }
              })
            }
            options={[
              { value: '1', label: p.linear },
              { value: '2', label: p.radial },
            ]}
            aria-label={p.gradientType}
          />
        </div>
        {single && (
          <IconButton
            icon={ArrowLeftRight}
            label={t.inspector.gradient.reverse}
            tooltipSide="left"
            onClick={() => reverseGradient(t.inspector.history.gradient, paths[0])}
          />
        )}
      </InspectorRow>
      {single && (
        <GradientStopsRow
          label={t.inspector.gradient.stops}
          path={paths[0]}
          gradient={items[0].g}
          target={{ path: [...paths[0], 'g', 'k'], frame: times[0].frame, toRoot: times[0].toRoot }}
        />
      )}
      <ScalarProperty
        label={p.opacity}
        targets={propTargets(paths, 'o', times, staticProperty(100))}
        props={pick(items, (i) => i.o)}
        fallback={100}
        unit="%"
        precision={0}
        min={0}
        max={100}
        resettable
      />
      <VectorProperty
        label={p.startPoint}
        targets={propTargets(paths, 's', times, staticProperty([0, 0]))}
        props={pick(items, (i) => i.s)}
        fallback={[0, 0]}
      />
      <VectorProperty
        label={p.endPoint}
        targets={propTargets(paths, 'e', times, staticProperty([100, 0]))}
        props={pick(items, (i) => i.e)}
        fallback={[100, 0]}
      />
      {radial && (
        <>
          <ScalarProperty
            label={p.highlightLength}
            targets={propTargets(paths, 'h', times, staticProperty(0))}
            props={pick(items, (i) => i.h)}
            unit="%"
            precision={1}
            min={-100}
            max={100}
            resettable
          />
          <ScalarProperty
            label={p.highlightAngle}
            targets={propTargets(paths, 'a', times, staticProperty(0))}
            props={pick(items, (i) => i.a)}
            unit="°"
            precision={1}
            resettable
          />
        </>
      )}
      {stroke ? (
        <StrokeStyle paths={paths} items={items as GradientStrokeShape[]} times={times} />
      ) : (
        <FillRuleRow paths={paths} items={items as GradientFillShape[]} />
      )}
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Geometry                                  */
/* -------------------------------------------------------------------------- */

function DirectionRow({ paths, items }: { paths: NodePath[]; items: { d?: number }[] }) {
  const t = useT()
  const p = t.inspector.props
  const dir = commonValue(items.map((i) => (i.d === 3 ? '3' : '1')))
  return (
    <SegmentRow<'1' | '3'>
      label={p.direction}
      value={dir}
      options={[
        { value: '1', label: p.directionNormal },
        { value: '3', label: p.directionReversed },
      ]}
      onChange={(v) =>
        editItems<{ d?: number }>(
          t.inspector.history.change(p.direction),
          paths,
          (i) => void (i.d = Number(v)),
        )
      }
    />
  )
}

export function RectSection({ paths, items, times }: ItemsProps<RectShape>) {
  const t = useT()
  const p = t.inspector.props
  return (
    <Section id="inspector.rect" title={t.common.shapeTypes.rc}>
      <VectorProperty
        label={p.size}
        axes={['W', 'H']}
        targets={propTargets(paths, 's', times, staticProperty([100, 100]))}
        props={pick(items, (i) => i.s)}
        fallback={[100, 100]}
        min={0}
      />
      <VectorProperty
        label={p.position}
        targets={propTargets(paths, 'p', times, staticProperty([0, 0]))}
        props={pick(items, (i) => i.p)}
        fallback={[0, 0]}
        resettable
      />
      <ScalarProperty
        label={p.roundness}
        targets={propTargets(paths, 'r', times, staticProperty(0))}
        props={pick(items, (i) => i.r)}
        unit="px"
        precision={1}
        min={0}
        resettable
      />
      <DirectionRow paths={paths} items={items} />
    </Section>
  )
}

export function EllipseSection({ paths, items, times }: ItemsProps<EllipseShape>) {
  const t = useT()
  const p = t.inspector.props
  return (
    <Section id="inspector.ellipse" title={t.common.shapeTypes.el}>
      <VectorProperty
        label={p.size}
        axes={['W', 'H']}
        targets={propTargets(paths, 's', times, staticProperty([100, 100]))}
        props={pick(items, (i) => i.s)}
        fallback={[100, 100]}
        min={0}
      />
      <VectorProperty
        label={p.position}
        targets={propTargets(paths, 'p', times, staticProperty([0, 0]))}
        props={pick(items, (i) => i.p)}
        fallback={[0, 0]}
        resettable
      />
      <DirectionRow paths={paths} items={items} />
    </Section>
  )
}

export function StarSection({ paths, items, times }: ItemsProps<StarShape>) {
  const t = useT()
  const p = t.inspector.props
  const kind = commonValue(items.map((i) => (i.sy === 2 ? '2' : '1')))
  const star = items.some((i) => i.sy !== 2)
  return (
    <Section id="inspector.star" title={kind === '2' ? t.common.polygon : t.common.shapeTypes.sr}>
      <InspectorRow label={p.shapeType}>
        <IconSegmented<'1' | '2'>
          value={kind}
          label={p.shapeType}
          options={[
            { value: '1', icon: StarIcon, title: p.star },
            { value: '2', icon: Hexagon, title: p.polygon },
          ]}
          onChange={(v) =>
            editItems<StarShape>(t.inspector.history.shape, paths, (i) => {
              i.sy = v === '2' ? 2 : 1
              if (i.sy === 1) {
                // Stars need an inner radius and roundness.
                i.ir ??= {
                  a: 0,
                  k: Math.round(((typeof i.or?.k === 'number' ? i.or.k : 50) / 2) * 10) / 10,
                }
                i.is ??= { a: 0, k: 0 }
              }
            })
          }
        />
      </InspectorRow>
      <ScalarProperty
        label={p.points}
        targets={propTargets(paths, 'pt', times, staticProperty(5))}
        props={pick(items, (i) => i.pt)}
        fallback={5}
        precision={0}
        min={3}
        max={100}
      />
      <VectorProperty
        label={p.position}
        targets={propTargets(paths, 'p', times, staticProperty([0, 0]))}
        props={pick(items, (i) => i.p)}
        fallback={[0, 0]}
        resettable
      />
      <ScalarProperty
        label={p.rotation}
        targets={propTargets(paths, 'r', times, staticProperty(0))}
        props={pick(items, (i) => i.r)}
        unit="°"
        resettable
      />
      <ScalarProperty
        label={p.outerRadius}
        targets={propTargets(paths, 'or', times, staticProperty(50))}
        props={pick(items, (i) => i.or)}
        fallback={50}
        unit="px"
        min={0}
      />
      <ScalarProperty
        label={p.outerRoundness}
        targets={propTargets(paths, 'os', times, staticProperty(0))}
        props={pick(items, (i) => i.os)}
        unit="%"
        resettable
      />
      {star && (
        <>
          <ScalarProperty
            label={p.innerRadius}
            targets={propTargets(paths, 'ir', times, staticProperty(25))}
            props={pick(items, (i) => i.ir)}
            fallback={25}
            unit="px"
            min={0}
          />
          <ScalarProperty
            label={p.innerRoundness}
            targets={propTargets(paths, 'is', times, staticProperty(0))}
            props={pick(items, (i) => i.is)}
            unit="%"
            resettable
          />
        </>
      )}
      <DirectionRow paths={paths} items={items} />
    </Section>
  )
}

export function PathSection({ paths, items, times }: ItemsProps<PathShape>) {
  const t = useT()
  const p = t.inspector.props
  const shape = evaluatePath(items[0].ks, times[0].frame)
  const animated = items.some((i) => isAnimated(i.ks))
  return (
    <Section id="inspector.path" title={t.common.shapeTypes.sh}>
      <InspectorRow label={p.path}>
        <span className="min-w-0 truncate text-sm text-fg-muted tabular-nums">
          {p.vertices(shape?.v?.length ?? 0)}, {shape?.c === false ? p.open : p.closed}
        </span>
        {animated && <Badge tone="accent">{p.animatedPath}</Badge>}
      </InspectorRow>
      <DirectionRow paths={paths} items={items} />
      <Note icon={<Info size={12} />} className="pl-5">
        {p.pathHint}
      </Note>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Modifiers                                 */
/* -------------------------------------------------------------------------- */

export function TrimSection({ paths, items, times }: ItemsProps<TrimShape>) {
  const t = useT()
  const p = t.inspector.props
  const mode = commonValue(items.map((i) => (i.m === 2 ? '2' : '1')))
  return (
    <Section id="inspector.trim" title={t.common.shapeTypes.tm}>
      <ScalarProperty
        label={p.trimStart}
        targets={propTargets(paths, 's', times, staticProperty(0))}
        props={pick(items, (i) => i.s)}
        unit="%"
        precision={1}
        min={0}
        max={100}
        resettable
      />
      <ScalarProperty
        label={p.trimEnd}
        targets={propTargets(paths, 'e', times, staticProperty(100))}
        props={pick(items, (i) => i.e)}
        fallback={100}
        unit="%"
        precision={1}
        min={0}
        max={100}
        resettable
      />
      <ScalarProperty
        label={p.trimOffset}
        targets={propTargets(paths, 'o', times, staticProperty(0))}
        props={pick(items, (i) => i.o)}
        unit="°"
        precision={1}
        resettable
      />
      <SelectRow<'1' | '2'>
        label={p.trimMode}
        value={mode}
        options={[
          { value: '1', label: p.simultaneously },
          { value: '2', label: p.individually },
        ]}
        onChange={(v) =>
          editItems<TrimShape>(
            t.inspector.history.change(p.trimMode),
            paths,
            (i) => void (i.m = v === '2' ? 2 : 1),
          )
        }
      />
    </Section>
  )
}

export function RepeaterSection({ paths, items, times }: ItemsProps<RepeaterShape>) {
  const t = useT()
  const p = t.inspector.props
  const trBases = useMemo(() => paths.map((path) => [...path, 'tr']), [paths])
  const composite = commonValue(items.map((i) => (i.m === 2 ? '2' : '1')))
  return (
    <>
      <Section id="inspector.repeater" title={t.common.shapeTypes.rp}>
        <ScalarProperty
          label={p.copies}
          targets={propTargets(paths, 'c', times, staticProperty(3))}
          props={pick(items, (i) => i.c)}
          fallback={3}
          precision={1}
          min={0}
        />
        <ScalarProperty
          label={p.offset}
          targets={propTargets(paths, 'o', times, staticProperty(0))}
          props={pick(items, (i) => i.o)}
          precision={1}
          resettable
        />
        <SegmentRow<'1' | '2'>
          label={p.composite}
          value={composite}
          options={[
            { value: '1', label: p.above },
            { value: '2', label: p.below },
          ]}
          onChange={(v) =>
            editItems<RepeaterShape>(
              t.inspector.history.change(p.composite),
              paths,
              (i) => void (i.m = v === '2' ? 2 : 1),
            )
          }
        />
      </Section>
      <TransformSection
        id="inspector.repeater.transform"
        title={p.repeaterTransform}
        bases={trBases}
        times={times}
        kind="repeater"
      />
    </>
  )
}

export function RoundCornersSection({ paths, items, times }: ItemsProps<RoundCornersShape>) {
  const t = useT()
  return (
    <Section id="inspector.roundCorners" title={t.common.shapeTypes.rd}>
      <ScalarProperty
        label={t.inspector.props.radius}
        targets={propTargets(paths, 'r', times, staticProperty(10))}
        props={pick(items, (i) => i.r)}
        fallback={10}
        unit="px"
        precision={1}
        min={0}
      />
    </Section>
  )
}

export function MergeSection({ paths, items }: ItemsProps<MergeShape>) {
  const t = useT()
  const p = t.inspector.props
  const mode = commonValue(items.map((i) => String(i.mm ?? 1)))
  return (
    <Section id="inspector.merge" title={t.common.shapeTypes.mm}>
      <SelectRow<string>
        label={p.mergeMode}
        value={mode}
        options={p.mergeModes.map((label, i) => ({ value: String(i + 1), label }))}
        onChange={(v) =>
          editItems<MergeShape>(
            t.inspector.history.change(p.mergeMode),
            paths,
            (i) => void (i.mm = Number(v)),
          )
        }
      />
      <Note className="pl-5">{p.mergeNote}</Note>
    </Section>
  )
}

export function OffsetPathSection({ paths, items, times }: ItemsProps<OffsetPathShape>) {
  const t = useT()
  const p = t.inspector.props
  const join = commonValue(items.map((i) => String(i.lj ?? 1) as Join))
  return (
    <Section id="inspector.offsetPath" title={t.common.shapeTypes.op}>
      <ScalarProperty
        label={p.amount}
        targets={propTargets(paths, 'a', times, staticProperty(0))}
        props={pick(items, (i) => i.a)}
        unit="px"
        precision={1}
        resettable
      />
      <InspectorRow label={p.lineJoin}>
        <IconSegmented<Join>
          value={join}
          label={p.lineJoin}
          options={[
            { value: '1', icon: JoinMiterIcon, title: p.joinMiter },
            { value: '2', icon: JoinRoundIcon, title: p.joinRound },
            { value: '3', icon: JoinBevelIcon, title: p.joinBevel },
          ]}
          onChange={(v) =>
            editItems<OffsetPathShape>(
              t.inspector.history.change(p.lineJoin),
              paths,
              (i) => void (i.lj = Number(v) as 1 | 2 | 3),
            )
          }
        />
      </InspectorRow>
      {join === '1' && (
        <ScalarProperty
          label={p.miterLimit}
          targets={propTargets(paths, 'ml', times, staticProperty(4))}
          props={pick(items, (i) => i.ml)}
          fallback={4}
          precision={1}
          min={1}
        />
      )}
    </Section>
  )
}

export function PuckerBloatSection({ paths, items, times }: ItemsProps<PuckerBloatShape>) {
  const t = useT()
  return (
    <Section id="inspector.puckerBloat" title={t.common.shapeTypes.pb}>
      <ScalarProperty
        label={t.inspector.props.amount}
        targets={propTargets(paths, 'a', times, staticProperty(0))}
        props={pick(items, (i) => i.a)}
        unit="%"
        precision={1}
        resettable
      />
    </Section>
  )
}

export function TwistSection({ paths, items, times }: ItemsProps<TwistShape>) {
  const t = useT()
  const p = t.inspector.props
  return (
    <Section id="inspector.twist" title={t.common.shapeTypes.tw}>
      <ScalarProperty
        label={p.angle}
        targets={propTargets(paths, 'a', times, staticProperty(0))}
        props={pick(items, (i) => i.a)}
        unit="°"
        precision={1}
        resettable
      />
      <VectorProperty
        label={p.center}
        targets={propTargets(paths, 'c', times, staticProperty([0, 0]))}
        props={pick(items, (i) => i.c)}
        fallback={[0, 0]}
        resettable
      />
    </Section>
  )
}

export function ZigZagSection({ paths, items, times }: ItemsProps<ZigZagShape>) {
  const t = useT()
  const p = t.inspector.props
  const pointType = commonValue(
    items.map((i) => {
      const k = i.pt?.k
      return (typeof k === 'number'
        ? k
        : Array.isArray(k) && typeof k[0] === 'number'
          ? k[0]
          : 1) === 2
        ? '2'
        : '1'
    }),
  )
  return (
    <Section id="inspector.zigzag" title={t.common.shapeTypes.zz}>
      <ScalarProperty
        label={p.size}
        targets={propTargets(paths, 's', times, staticProperty(10))}
        props={pick(items, (i) => i.s)}
        fallback={10}
        unit="px"
        precision={1}
      />
      <ScalarProperty
        label={p.ridges}
        targets={propTargets(paths, 'r', times, staticProperty(5))}
        props={pick(items, (i) => i.r)}
        fallback={5}
        precision={0}
        min={0}
      />
      <SegmentRow<'1' | '2'>
        label={p.pointType}
        value={pointType}
        options={[
          { value: '1', label: p.corner },
          { value: '2', label: p.smooth },
        ]}
        onChange={(v) =>
          editItems<ZigZagShape>(t.inspector.history.change(p.pointType), paths, (i) => {
            i.pt = { a: 0, k: v === '2' ? 2 : 1 }
          })
        }
      />
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Group                                   */
/* -------------------------------------------------------------------------- */

export function GroupSections({ paths, items, times }: ItemsProps<GroupShape>) {
  const t = useT()
  // The group transform is the `tr` item (normally the last one).
  const trKey = items
    .map((g) => (Array.isArray(g.it) ? g.it.findIndex((i) => i.ty === 'tr') : -1))
    .join(',')
  const trBases = useMemo(() => {
    const indices = trKey.split(',').map(Number)
    return paths.flatMap((p, i) => (indices[i] >= 0 ? [[...p, 'it', indices[i]]] : []))
  }, [paths, trKey])
  const trTimes = useMemo(() => {
    const indices = trKey.split(',').map(Number)
    return times.filter((_, i) => indices[i] >= 0)
  }, [times, trKey])
  const itBase = useMemo(() => (paths.length === 1 ? [...paths[0], 'it'] : null), [paths])
  return (
    <>
      {trBases.length > 0 && (
        <TransformSection
          id="inspector.group.transform"
          title={t.inspector.sections.transform}
          bases={trBases}
          times={trTimes}
          kind="group"
        />
      )}
      {itBase && <AppearanceSection base={itBase} time={times[0]} />}
    </>
  )
}
