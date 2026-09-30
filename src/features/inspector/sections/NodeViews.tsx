/**
 * Views for selected nodes: one or several layers, one or several shape items of the same
 * type, or a mixed selection.
 */
import { Info } from 'lucide-react'
import { memo, useMemo } from 'react'
import { Section } from '@/components/ui'
import { LayerKindIcon, ShapeTypeIcon } from '@/components/lottie/icons'
import { layerDisplayName, nodeDisplayName, shapeDisplayName } from '@/components/lottie/labels'
import { useT } from '@/i18n'
import { layerKind } from '@/lottie/layers'
import { getAt, isLayerPath, pathKey, type NodePath } from '@/lottie/path'
import type {
  EllipseShape,
  FillShape,
  GradientFillShape,
  GradientStrokeShape,
  GroupShape,
  Layer,
  MergeShape,
  OffsetPathShape,
  PathShape,
  PuckerBloatShape,
  RectShape,
  RepeaterShape,
  RoundCornersShape,
  ShapeItem,
  StarShape,
  StrokeShape,
  TrimShape,
  TwistShape,
  ZigZagShape,
} from '@/lottie/types'
import {
  isImageLayer,
  isPrecompLayer,
  isShapeLayer,
  isSolidLayer,
  isTextLayer,
} from '@/lottie/types'
import { getDoc, selectNodes } from '@/store/document'
import { Note } from '../components/Row'
import { useNodesAt } from '../hooks'
import type { CompTime } from '../model/time'
import { AppearanceSection } from './AppearanceSection'
import { LayerSection } from './LayerSection'
import { ImageSection, PrecompSection, SolidSection } from './LayerTypeSections'
import { EffectsSection } from './effects/EffectsSection'
import { MasksSection } from './MasksEffects'
import {
  EllipseSection,
  FillSection,
  GradientSection,
  GroupSections,
  MergeSection,
  OffsetPathSection,
  PathSection,
  PuckerBloatSection,
  RectSection,
  RepeaterSection,
  RoundCornersSection,
  StarSection,
  StrokeSection,
  TrimSection,
  TwistSection,
  ZigZagSection,
} from './ShapeSections'
import { TextSection } from './TextSection'
import { TransformSection } from './TransformSection'

/* -------------------------------------------------------------------------- */
/*                                Time context                                */
/* -------------------------------------------------------------------------- */

/** Explains how the playhead maps into a precomp shared by several layers (or none). */
export function TimeNote({ time }: { time: CompTime }) {
  const t = useT()
  if (time.assetIndex === null) return null
  let text: string | null = null
  if (time.orphan) text = t.inspector.time.orphan
  else if (time.remapped) text = t.inspector.time.remapped
  else if (time.instances > 1) {
    const doc = getDoc()
    const via = time.chain[time.chain.length - 1]
    const name = doc && via ? nodeDisplayName(doc, via, t) : ''
    text = t.inspector.time.shared(time.instances, name, via ? Number(via[via.length - 1]) + 1 : 0)
  }
  if (!text) return null
  return (
    <div className="border-b border-line px-3 py-2">
      <Note icon={<Info size={12} />}>{text}</Note>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Layers                                   */
/* -------------------------------------------------------------------------- */

/**
 * One or more layers. Memoized with stable `paths`/`times`; the sections read their own
 * slices of the document so an edit only re-renders the sections it touches.
 */
export const LayerView = memo(function LayerView({
  paths,
  times,
}: {
  paths: NodePath[]
  times: CompTime[]
}) {
  const t = useT()
  const layers = useNodesAt<Layer>(paths)
  const ksBases = useMemo(() => paths.map((p) => [...p, 'ks']), [paths])
  const shapesBase = useMemo(() => (paths.length === 1 ? [...paths[0], 'shapes'] : null), [paths])
  if (layers.some((l) => !l)) return null
  const first = layers[0] as Layer
  const single = paths.length === 1
  const threeD = layers.every((l) => l?.ddd === 1)
  return (
    <>
      <LayerSection paths={paths} times={times} />
      <TransformSection
        id="inspector.transform"
        title={t.inspector.sections.transform}
        bases={ksBases}
        times={times}
        kind="layer"
        threeD={threeD}
      />
      {single && isSolidLayer(first) && <SolidSection path={paths[0]} layer={first} />}
      {single && isTextLayer(first) && (
        <TextSection path={paths[0]} layer={first} time={times[0]} />
      )}
      {single && isImageLayer(first) && <ImageSection layer={first} />}
      {single && isPrecompLayer(first) && <PrecompSection path={paths[0]} layer={first} />}
      {single && isShapeLayer(first) && shapesBase && (
        <AppearanceSection base={shapesBase} time={times[0]} />
      )}
      {single && <MasksSection path={paths[0]} time={times[0]} />}
      {single && <EffectsSection path={paths[0]} time={times[0]} />}
    </>
  )
})

/* -------------------------------------------------------------------------- */
/*                                 Shape items                                */
/* -------------------------------------------------------------------------- */

/** Sections for shape items that all share the same `ty`. */
export function ShapeView({
  paths,
  items,
  times,
}: {
  paths: NodePath[]
  items: ShapeItem[]
  times: CompTime[]
}) {
  const t = useT()
  const p = { paths, times }
  switch (items[0].ty) {
    case 'fl':
      return <FillSection {...p} items={items as FillShape[]} />
    case 'st':
      return <StrokeSection {...p} items={items as StrokeShape[]} />
    case 'gf':
    case 'gs':
      return <GradientSection {...p} items={items as (GradientFillShape | GradientStrokeShape)[]} />
    case 'rc':
      return <RectSection {...p} items={items as RectShape[]} />
    case 'el':
      return <EllipseSection {...p} items={items as EllipseShape[]} />
    case 'sr':
      return <StarSection {...p} items={items as StarShape[]} />
    case 'sh':
      return <PathSection {...p} items={items as PathShape[]} />
    case 'tm':
      return <TrimSection {...p} items={items as TrimShape[]} />
    case 'rp':
      return <RepeaterSection {...p} items={items as RepeaterShape[]} />
    case 'rd':
      return <RoundCornersSection {...p} items={items as RoundCornersShape[]} />
    case 'mm':
      return <MergeSection {...p} items={items as MergeShape[]} />
    case 'op':
      return <OffsetPathSection {...p} items={items as OffsetPathShape[]} />
    case 'pb':
      return <PuckerBloatSection {...p} items={items as PuckerBloatShape[]} />
    case 'tw':
      return <TwistSection {...p} items={items as TwistShape[]} />
    case 'zz':
      return <ZigZagSection {...p} items={items as ZigZagShape[]} />
    case 'gr':
      return <GroupSections {...p} items={items as GroupShape[]} />
    case 'tr':
      return (
        <TransformSection
          id="inspector.group.transform"
          title={t.inspector.sections.transform}
          bases={paths}
          times={times}
          kind="group"
        />
      )
    default:
      return (
        <div className="px-3 py-3">
          <Note icon={<Info size={12} />}>{t.inspector.noProperties}</Note>
        </div>
      )
  }
}

/* -------------------------------------------------------------------------- */
/*                               Mixed selection                              */
/* -------------------------------------------------------------------------- */

/** Different kinds of nodes: list them so one can be picked. */
export function MixedView({ paths }: { paths: NodePath[] }) {
  const t = useT()
  const doc = getDoc()
  if (!doc) return null
  return (
    <Section id="inspector.selection" title={t.inspector.sections.selection} static>
      <Note className="pb-1">{t.inspector.multi.mixedKinds}</Note>
      <div className="-mx-1.5 flex flex-col">
        {paths.map((path) => {
          const node = getAt<Layer | ShapeItem>(doc, path)
          if (!node) return null
          const isLayer = isLayerPath(path)
          const name = isLayer
            ? layerDisplayName(node as Layer, path[path.length - 1] as number, t)
            : shapeDisplayName(node as ShapeItem, t)
          return (
            <button
              key={pathKey(path)}
              type="button"
              title={t.inspector.multi.selectOnly}
              onClick={() => selectNodes([path])}
              className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm text-fg hover:bg-hover"
            >
              {isLayer ? (
                <LayerKindIcon kind={layerKind(node as Layer)} />
              ) : (
                <ShapeTypeIcon item={node as ShapeItem} />
              )}
              <span className="truncate">{name}</span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}
