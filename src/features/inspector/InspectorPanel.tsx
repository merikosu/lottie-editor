/**
 * The contextual inspector (right sidebar, "Properties"):
 *  - nothing selected → the animation (document sections)
 *  - layers / shape items → their properties (several of the same kind edit together)
 *  - keyframes selected in the timeline → keyframe details and the easing editor on top
 */
import { Clapperboard, Layers, MousePointer2, Shapes } from 'lucide-react'
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { EmptyState } from '@/components/ui'
import { shapeIcon } from '@/components/lottie/icon-maps'
import { layerDisplayName, shapeDisplayName } from '@/components/lottie/labels'
import { setLocked, useNodeLocked } from '@/features/layers'
import { useLanguage, useT, type Dict } from '@/i18n'
import { formatDecimal } from '@/lib/format'
import { layerKind } from '@/lottie/layers'
import { getAt, isLayerPath, isShapePath, pathFromKey, pathKey, type NodePath } from '@/lottie/path'
import type { Layer, ShapeItem } from '@/lottie/types'
import { updateDoc, useDocument } from '@/store/document'
import { KIND_OPTION_ICONS } from './components/kind-icons'
import { DiamondIcon } from './components/icons'
import { useCompTimes, useNodesAt } from './hooks'
import { commonValue } from './model/values'
import { nameText } from './model/names'
import { DocumentView } from './sections/DocumentView'
import { InspectorHeader, type HeaderProps } from './sections/InspectorHeader'
import { KeyframesSection } from './sections/KeyframesSection'
import { LayerView, MixedView, ShapeView, TimeNote } from './sections/NodeViews'

/**
 * Label column width per language (Russian labels are ~30% longer). It grows with the
 * panel, so widening the panel reveals long labels instead of only stretching the fields.
 */
const LABEL_WIDTH: Record<string, string> = {
  en: 'clamp(108px, 38%, 150px)',
  ru: 'clamp(112px, 40%, 160px)',
}

export function InspectorPanel() {
  const t = useT()
  const language = useLanguage()
  const hasDoc = useDocument((s) => s.doc !== null)
  const selection = useDocument((s) => s.selection)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasKeys = selection.keyframes.length > 0

  // Keyframe details appear at the top: make sure they are visible.
  useEffect(() => {
    if (hasKeys) scrollRef.current?.scrollTo({ top: 0 })
  }, [hasKeys])

  const style = { '--insp-label': LABEL_WIDTH[language] ?? LABEL_WIDTH.en } as CSSProperties

  if (!hasDoc) {
    return <EmptyState icon={Clapperboard} title={t.inspector.noDocument} />
  }

  const nodes = selection.nodes
  const empty = nodes.length === 0 && !hasKeys
  const scrollKey = nodes.length ? nodes.map(pathKey).join('|') : 'document'

  return (
    <div className="flex h-full min-h-0 flex-col" style={style} data-testid="inspector">
      {empty ? (
        <DocumentHeader />
      ) : nodes.length ? (
        <NodesHeader paths={nodes} />
      ) : (
        <KeyframesHeader count={selection.keyframes.length} />
      )}
      <div
        ref={scrollRef}
        key={scrollKey}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-6"
      >
        {empty ? (
          <DocumentView />
        ) : (
          <>
            {nodes.length > 0 && <NodesTimeNote paths={nodes} />}
            {hasKeys && (
              <KeyframesSection keyframes={selection.keyframes} property={selection.property} />
            )}
            {nodes.length > 0 && <NodesView paths={nodes} />}
          </>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Headers                                  */
/* -------------------------------------------------------------------------- */

function DocumentHeader() {
  const t = useT()
  const name = useDocument((s) => nameText(s.doc?.nm))
  const summary = useDocument((s) =>
    s.doc
      ? `${formatDecimal(s.doc.w, 2)} × ${formatDecimal(s.doc.h, 2)} · ${formatDecimal(s.doc.fr, 2)} ${t.common.fps}`
      : '',
  )
  return (
    <InspectorHeader
      icon={Clapperboard}
      name={name}
      placeholder={t.inspector.header.untitledAnimation}
      subtitle={summary}
      commands={['anim.resize', 'anim.timing', 'anim.optimize', 'file.export']}
    />
  )
}

function KeyframesHeader({ count }: { count: number }) {
  const t = useT()
  return <InspectorHeader icon={DiamondIcon} name={t.inspector.header.keyframesSelected(count)} />
}

function fmtFrame(f: number): string {
  return formatDecimal(f, 2)
}

function layerSubtitle(layer: Layer, t: Dict): string {
  const kind = t.common.layerKinds[layerKind(layer)]
  const time = t.inspector.header.inOut(fmtFrame(layer.ip), fmtFrame(layer.op))
  // A layer named after its kind ("Null") would read "Null · Null · 0 → 60".
  return nameText(layer.nm).toLowerCase() === kind.toLowerCase() ? time : `${kind} · ${time}`
}

function shapeSubtitle(item: ShapeItem, t: Dict): string {
  const type =
    item.ty === 'sr' && item.sy === 2
      ? t.common.polygon
      : ((t.common.shapeTypes as Record<string, string>)[item.ty] ?? t.common.shapeTypes.unknown)
  if (item.ty === 'gr') {
    const count = (item.it ?? []).filter((i) => i.ty !== 'tr').length
    return `${type} · ${t.inspector.header.groupItems(count)}`
  }
  return type
}

function renameNode(label: string, path: NodePath, name: string) {
  updateDoc(label, (draft) => {
    const node = getAt<{ nm?: string }>(draft, path)
    if (!node) return
    if (name) node.nm = name
    else delete node.nm
  })
}

function setHidden(label: string, paths: NodePath[], hidden: boolean) {
  updateDoc(label, (draft) => {
    for (const p of paths) {
      const node = getAt<{ hd?: boolean }>(draft, p)
      if (!node) continue
      // Exporters write `hd: false` on shape items: keep the field, just flip it.
      if (hidden) node.hd = true
      else if (node.hd !== undefined) node.hd = false
    }
  })
}

function NodesHeader({ paths }: { paths: NodePath[] }) {
  const t = useT()
  const nodes = useNodesAt<Layer | ShapeItem>(paths)
  // Locks are canvas-only (the layer list and this panel still edit locked nodes).
  const locked = useNodeLocked(paths[paths.length - 1])
  const present = paths.filter((_, i) => !!nodes[i])
  const items = nodes.filter((n): n is Layer | ShapeItem => !!n)
  if (items.length === 0)
    return <InspectorHeader icon={MousePointer2} name={t.inspector.header.selection} />

  const hidden = commonValue(items.map((n) => !!n.hd))
  const toggleHidden = () => setHidden(t.inspector.history.visibility, present, hidden !== true)
  const toggleLocked = () => setLocked(locked ? present.flatMap(lockAncestry) : present, !locked)
  const commands = ['edit.duplicate', 'edit.delete']

  if (items.length === 1) {
    const path = present[0]
    const node = items[0]
    let props: HeaderProps
    if (isLayerPath(path)) {
      const layer = node as Layer
      const index = path[path.length - 1] as number
      props = {
        icon: KIND_OPTION_ICONS[layerKind(layer)],
        iconClassName: '',
        name: nameText(layer.nm),
        placeholder: layerDisplayName({ ...layer, nm: undefined }, index, t),
        subtitle: layerSubtitle(layer, t),
      }
    } else {
      const item = node as ShapeItem
      const subtitle = shapeSubtitle(item, t)
      props = {
        icon: shapeIcon(item),
        name: nameText(item.nm),
        placeholder: shapeDisplayName({ ...item, nm: undefined } as ShapeItem, t),
        // "Stroke · Stroke" says nothing: the type is shown only when the name differs from it.
        subtitle: nameText(item.nm).toLowerCase() === subtitle.toLowerCase() ? undefined : subtitle,
      }
    }
    return (
      <InspectorHeader
        {...props}
        onRename={(name) => renameNode(t.inspector.history.rename, path, name)}
        hidden={hidden}
        onToggleHidden={toggleHidden}
        locked={locked}
        onToggleLocked={toggleLocked}
        paths={[path]}
        commands={commands}
      />
    )
  }

  const allLayers = present.every(isLayerPath)
  return (
    <InspectorHeader
      icon={allLayers ? Layers : Shapes}
      name={
        allLayers
          ? t.inspector.header.layersSelected(items.length)
          : t.inspector.header.itemsSelected(items.length)
      }
      hidden={hidden}
      onToggleHidden={toggleHidden}
      locked={locked}
      onToggleLocked={toggleLocked}
      paths={present}
      commands={commands}
    />
  )
}

/** The node and the layer/groups containing it: a lock on any of them locks the node. */
function lockAncestry(path: NodePath): NodePath[] {
  const out: NodePath[] = []
  for (let n = path.length; n >= 2; n--) {
    const p = path.slice(0, n)
    if (isLayerPath(p) || isShapePath(p)) out.push(p)
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                    Views                                   */
/* -------------------------------------------------------------------------- */

function NodesTimeNote({ paths }: { paths: NodePath[] }) {
  const times = useCompTimes(paths.slice(-1))
  return times[0] ? <TimeNote time={times[0]} /> : null
}

function NodesView({ paths }: { paths: NodePath[] }): ReactNode {
  const t = useT()
  const nodes = useNodesAt<Layer | ShapeItem>(paths)
  // A stable array of the selected paths that exist, so memoized views keep their props.
  const presentKey = paths
    .filter((_, i) => !!nodes[i])
    .map(pathKey)
    .join('|')
  const present = useMemo(
    () => (presentKey ? presentKey.split('|').map(pathFromKey) : []),
    [presentKey],
  )
  const items = nodes.filter((n): n is Layer | ShapeItem => !!n)
  const times = useCompTimes(present)
  if (items.length === 0 || times.length !== items.length) return null

  if (present.every(isLayerPath)) return <LayerView paths={present} times={times} />
  if (present.every(isShapePath)) {
    const shapes = items as ShapeItem[]
    if (shapes.every((s) => s.ty === shapes[0].ty))
      return <ShapeView paths={present} items={shapes} times={times} />
  }
  if (present.length === 1) {
    return (
      <EmptyState
        icon={MousePointer2}
        title={t.inspector.unsupported}
        description={t.inspector.unsupportedHint}
      />
    )
  }
  return <MixedView paths={present} />
}
