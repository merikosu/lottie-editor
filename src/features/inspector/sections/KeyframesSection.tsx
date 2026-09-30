/**
 * Selected keyframes (from the timeline): summary, frame and value of a single key, and the
 * easing editor for the selected segments. Shown at the top of the inspector.
 */
import { Info, X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { ColorField, IconButton, Section, type ChangeGesture } from '@/components/ui'
import { NumberField } from '../components/number-field'
import { nodeBreadcrumb, nodeDisplayName } from '@/components/lottie/labels'
import { useDocumentColors } from '@/features/colors'
import { useT } from '@/i18n'
import { formatDecimal } from '@/lib/format'
import { roundTo } from '@/lib/math'
import { setKeyframeTime, setKeyframeValue } from '@/lottie/keyframes'
import { getAt, layerPathOf, pathEquals, pathFromKey, pathKey, type NodePath } from '@/lottie/path'
import { getKeyframes, type AnyProperty } from '@/lottie/property'
import { setTextContent, textToEditor } from '@/lottie/text'
import type {
  BezierPath,
  GradientColors,
  Keyframe,
  Layer,
  TextData,
  TextDocument,
} from '@/lottie/types'
import { getDoc, selectKeyframes, updateDoc, useDocument, type KeyframeRef } from '@/store/document'
import { CountTitle, InspectorRow, Note, RowLabel, ValueGrid } from '../components/Row'
import { TextContentField } from '../components/TextContentField'
import { gestureOptions, propertyAt } from '../edit'
import { EasingEditor } from '../easing/EasingEditor'
import { useCompTimes, useNodesAt } from '../hooks'
import { describeProperty, type PropDescription } from '../model/describe'
import { isTextDocumentPath, segmentsForSelection } from '../model/easing'
import { cssGradient, parseStops } from '../model/gradient'
import type { CompTime } from '../model/time'
import { decodeColor, encodeColor, usesLegacyColorScale } from '../model/values'

const fmt = (f: number) => formatDecimal(f, 2)

export function KeyframesSection({
  keyframes,
  property,
}: {
  keyframes: KeyframeRef[]
  property: NodePath | null
}) {
  const t = useT()
  const tk = t.inspector.keyframes
  const propKeys = [...new Set(keyframes.map((k) => pathKey(k.path)))]
  const propPaths = propKeys.map(pathFromKey)
  const props = useNodesAt<AnyProperty>(propPaths)
  const times = useCompTimes(propPaths)
  // Recompute when any involved property changes (its keyframes may have moved).
  const doc = getDoc()
  if (!doc) return null

  const valid = keyframes.filter((k) => {
    const prop = props[propKeys.indexOf(pathKey(k.path))]
    return !!getKeyframes(prop)?.[k.index]
  })
  if (valid.length === 0) return null

  const segmentSelection = segmentsForSelection(doc, valid, property)
  const rootFrames = valid.map((k) => {
    const i = propKeys.indexOf(pathKey(k.path))
    const kf = getKeyframes(props[i])?.[k.index]
    return kf ? (times[i]?.toRoot(kf.t) ?? kf.t) : 0
  })
  const minFrame = Math.min(...rootFrames)
  const maxFrame = Math.max(...rootFrames)
  const single = valid.length === 1 ? valid[0] : null
  const singleIndex = single ? propKeys.indexOf(pathKey(single.path)) : -1
  const onlyText = valid.every((k) => isTextDocumentPath(k.path))
  const description = propPaths.length === 1 ? describeProperty(doc, propPaths[0], t) : null
  // Several properties: list their names, and name the layer when they all belong to one.
  const title = description
    ? description.label
    : [...new Set(propPaths.map((p) => describeProperty(doc, p, t).label))].join(', ')
  const layerPaths = propPaths.map(layerPathOf)
  const oneLayer =
    layerPaths[0] && layerPaths.every((p) => p && pathEquals(p, layerPaths[0]!))
      ? layerPaths[0]
      : null
  const owner =
    propPaths.length === 1
      ? nodeBreadcrumb(doc, propPaths[0], t).slice(-2).join(' › ')
      : oneLayer
        ? nodeDisplayName(doc, oneLayer, t)
        : ''

  return (
    <Section
      id="inspector.keyframes"
      title={
        valid.length === 1 ? (
          t.inspector.sections.keyframe
        ) : (
          <CountTitle title={t.inspector.sections.keyframes} count={valid.length} />
        )
      }
      actions={
        <IconButton
          icon={X}
          size="sm"
          label={t.commands.deselect}
          tooltipSide="left"
          onClick={() => selectKeyframes([])}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-0.5 pb-0.5 pl-5">
        <div className="flex min-w-0 items-baseline gap-2">
          <RowLabel label={title} className="flex-initial text-sm font-medium text-fg" />
          {owner && (
            <span className="min-w-0 flex-1 truncate text-right text-xs text-fg-subtle">
              {owner}
            </span>
          )}
        </div>
        <span className="text-xs text-fg-subtle tabular-nums">
          {tk.summary(valid.length)}
          {propPaths.length > 1 && ` ${tk.onProperties(propPaths.length)}`} ·{' '}
          {minFrame === maxFrame
            ? tk.atFrame(fmt(minFrame))
            : tk.range(fmt(minFrame), fmt(maxFrame))}
        </span>
      </div>
      {single && description && props[singleIndex] && times[singleIndex] && (
        <SingleKeyframe
          refKey={single}
          prop={props[singleIndex]!}
          time={times[singleIndex]}
          description={description}
        />
      )}
      {onlyText ? (
        <Note icon={<Info size={12} />} className="pl-5">
          {t.inspector.easing.textHold}
        </Note>
      ) : segmentSelection.segments.length > 0 ? (
        <>
          {segmentSelection.incoming && <Note className="pl-5">{t.inspector.easing.incoming}</Note>}
          <EasingEditor segments={segmentSelection.segments} />
        </>
      ) : (
        <Note icon={<Info size={12} />} className="pl-5">
          {t.inspector.easing.noSegment}
        </Note>
      )}
    </Section>
  )
}

/** Frame and value of one selected keyframe. */
function SingleKeyframe({
  refKey,
  prop,
  time,
  description,
}: {
  refKey: KeyframeRef
  prop: AnyProperty
  time: CompTime
  description: PropDescription
}) {
  const t = useT()
  const tk = t.inspector.keyframes
  const swatches = useDocumentColors()
  const legacy = useDocument((s) => usesLegacyColorScale(s.doc?.v))
  const gradient = useDocument((s) =>
    s.doc ? getAt<GradientColors>(s.doc, refKey.path.slice(0, -1)) : undefined,
  )
  // Layers store x, y, z for anchor/position/scale; only 3D layers edit z.
  const threeD = useDocument((s) => {
    const layerPath = layerPathOf(refKey.path)
    return !!s.doc && !!layerPath && getAt<Layer>(s.doc, layerPath)?.ddd === 1
  })
  // Index of the key during a frame drag: it changes when the key passes another one, and
  // pointer events can arrive before the next render.
  const moving = useRef<{ key: string; index: number } | null>(null)
  const kf = getKeyframes(prop)?.[refKey.index] as Keyframe<unknown> | undefined
  if (!kf) return null
  const root = time.toRoot(kf.t)
  const mappable = root !== null

  const moveTo = (value: number, gesture: ChangeGesture) => {
    const { key } = gesture
    const local = mappable ? time.fromRoot(value) : value
    const index = moving.current?.key === key ? moving.current.index : refKey.index
    let next = index
    updateDoc(
      t.inspector.history.moveKey,
      (draft) => {
        const p = propertyAt(draft, refKey.path)
        if (!p) return
        // Source-text keyframes get no easing handles (they never interpolate).
        next = setKeyframeTime(p, index, roundTo(local, 3))
      },
      {
        ...gestureOptions(gesture),
        selection: (doc) => ({
          ...useDocument.getState().selection,
          keyframes:
            next >= 0 && getKeyframes(propertyAt(doc, refKey.path))?.[next]
              ? [{ path: refKey.path, index: next }]
              : [],
        }),
      },
    )
    moving.current = { key, index: next }
  }

  const setValue = (value: number | number[], gesture: ChangeGesture) =>
    updateDoc(
      t.inspector.history.keyValue,
      (draft) => {
        const p = propertyAt(draft, refKey.path)
        if (p) setKeyframeValue(p, refKey.index, value)
      },
      gestureOptions(gesture),
    )

  const s = kf.s
  let valueNode: ReactNode = null
  if (description.kind === 'number' && Array.isArray(s) && s.every((v) => typeof v === 'number')) {
    const values = s as number[]
    const dims = Math.min(values.length, threeD ? 3 : 2)
    const axes = description.axes ?? ['X', 'Y', 'Z']
    valueNode = (
      <ValueGrid className={dims === 3 ? 'grid-cols-3' : undefined}>
        {Array.from({ length: dims }, (_, d) => (
          <NumberField
            key={d}
            label={dims > 1 ? axes[d] : undefined}
            value={values[d]}
            precision={description.precision}
            suffix={description.unit}
            tone="keyframe"
            aria-label={dims > 1 ? `${description.label} ${axes[d]}` : description.label}
            onChange={(v, g) => {
              const next = [...values]
              next[d] = v
              setValue(next.length === 1 ? next[0] : next, g)
            }}
          />
        ))}
      </ValueGrid>
    )
  } else if (description.kind === 'color' && Array.isArray(s)) {
    const values = s as number[]
    valueNode = (
      <ColorField
        className="w-full"
        value={{ ...decodeColor(values, legacy), a: 1 }}
        alpha={false}
        swatches={swatches}
        onChange={(c, g) => {
          setValue(
            encodeColor(c, decodeColor(values, legacy).a, values.length >= 4 ? 4 : 3, legacy),
            g,
          )
        }}
      />
    )
  } else if (description.kind === 'path') {
    const path = (Array.isArray(s) ? s[0] : undefined) as BezierPath | undefined
    valueNode = (
      <span className="text-sm text-fg-muted tabular-nums">
        {tk.pathValue(path?.v?.length ?? 0)}
      </span>
    )
  } else if (description.kind === 'gradient' && Array.isArray(s)) {
    const count = gradient?.p ?? 0
    valueNode = (
      <span className="block h-6 w-full overflow-hidden rounded-sm checkerboard-sm shadow-[inset_0_0_0_1px_var(--le-line-strong)]">
        <span
          className="block h-full w-full"
          style={{ background: cssGradient(parseStops(s as number[], count)) }}
        />
      </span>
    )
  } else if (description.kind === 'text') {
    // Source text keyframe: edit its text directly (one undo step per editing session).
    const doc = s as TextDocument | undefined
    valueNode = (
      <TextContentField
        key={`${pathKey(refKey.path)}#${refKey.index}`}
        value={textToEditor(doc?.t)}
        maxRows={5}
        onChange={(text, gesture) =>
          updateDoc(
            t.inspector.history.editText,
            (draft) => {
              const data = getAt<TextData>(draft, refKey.path.slice(0, -1))
              if (data?.d) setTextContent(data, text, refKey.index)
            },
            gestureOptions(gesture),
          )
        }
      />
    )
  }

  return (
    <>
      <InspectorRow label={tk.frame} hint={mappable ? undefined : tk.compTime}>
        <ValueGrid>
          <NumberField
            value={roundTo(root ?? kf.t, 3)}
            precision={2}
            suffix={t.common.framesShort}
            aria-label={tk.frame}
            onChange={(v, g) => moveTo(v, g)}
          />
        </ValueGrid>
      </InspectorRow>
      {valueNode && (
        <InspectorRow label={tk.value} alignTop={description.kind === 'text'}>
          {valueNode}
        </InspectorRow>
      )}
    </>
  )
}
