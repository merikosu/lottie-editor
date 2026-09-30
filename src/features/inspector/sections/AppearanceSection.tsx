/**
 * Appearance: every fill, stroke and gradient inside a shape layer or group, with its color
 * editable in place (recoloring is the most common Lottie edit). Clicking a name selects the
 * item for the full editor.
 */
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Button, ColorField, Section } from '@/components/ui'
import { ShapeTypeIcon } from '@/components/lottie/icons'
import { shapeDisplayName } from '@/components/lottie/labels'
import { useDocumentColors } from '@/features/colors'
import { useT, type Dict } from '@/i18n'
import { pathEquals, pathFromKey, pathKey, type NodePath } from '@/lottie/path'
import { evaluateArray, isAnimated } from '@/lottie/property'
import { forEachShape } from '@/lottie/traverse'
import type { GradientFillShape, GradientStrokeShape, ShapeItem } from '@/lottie/types'
import { selectNodes, useDocument } from '@/store/document'
import { setHoverNode, useUi } from '@/store/ui'
import { editProperties, writeValue } from '../edit'
import { cssGradient, parseStops } from '../model/gradient'
import { nameText } from '../model/names'
import { useNodesAt } from '../hooks'
import type { CompTime } from '../model/time'
import { decodeColor, encodeColor, usesLegacyColorScale } from '../model/values'
import { RowLabel } from '../components/Row'

const PAINTS = new Set(['fl', 'st', 'gf', 'gs'])
const EMPTY: ShapeItem[] = []
const COLLAPSED_COUNT = 6
/** Beyond this, the Colors panel (virtualized, grouped) is the better tool. */
const EXPANDED_LIMIT = 100
/** Names exporters give by default ("Group 3", "Fill 1", "Gradient_x8Kd…"): they identify nothing. */
const GENERIC_NAME =
  /^(group|группа|fill|stroke|gradient( fill| stroke)?|заливка|обводка)([\s_]*[\w-]*)?$/i

interface Paint {
  item: ShapeItem
  path: NodePath
  /** Node outlined on the canvas while the row is hovered (the enclosing group or layer). */
  owner: NodePath
  label: string
  breadcrumb: string
}

function isMeaningful(name: unknown): boolean {
  const n = nameText(name)
  return !!n && !GENERIC_NAME.test(n)
}

/**
 * "Fill", "Stroke": what a generically named paint does. Gradients use the same words (their
 * swatch shows the gradient), which keeps labels short enough for the label column.
 */
function kindName(item: ShapeItem, t: Dict): string {
  const role = item.ty === 'gf' ? 'fl' : item.ty === 'gs' ? 'st' : item.ty
  const types: Record<string, string> = t.common.shapeTypes
  return Object.hasOwn(types, role) ? types[role] : t.common.shapeTypes.unknown
}

function collectPaints(items: ShapeItem[], base: NodePath, t: Dict): Paint[] {
  const out: Paint[] = []
  forEachShape(items, base, (item, path, parents) => {
    if (!PAINTS.has(item.ty) || item.hd) return
    const names = parents.map((g) => shapeDisplayName(g, t))
    const own = shapeDisplayName(item, t)
    // Prefer the item's own name, then the nearest meaningfully named group, then its kind
    // (the inspected layer's or group's name would repeat the header on every row).
    const group = [...parents].reverse().find((g) => isMeaningful(g.nm))
    out.push({
      item,
      path,
      owner: path.slice(0, -2),
      label: isMeaningful(item.nm)
        ? nameText(item.nm)
        : group
          ? shapeDisplayName(group, t)
          : kindName(item, t),
      breadcrumb: [...names, own].join(' › '),
    })
  })
  // Rows sharing a label get numbers so they can be told apart ("EYES 1", "Fill 2").
  const counts = new Map<string, number>()
  for (const p of out) counts.set(p.label, (counts.get(p.label) ?? 0) + 1)
  const seen = new Map<string, number>()
  for (const p of out) {
    if ((counts.get(p.label) ?? 0) < 2) continue
    const n = (seen.get(p.label) ?? 0) + 1
    seen.set(p.label, n)
    p.label = `${p.label} ${n}`
  }
  return out
}

/**
 * Paints inside `base` (a layer's `shapes` or a group's `it`). Memoized: pass a stable
 * `base`; the items are read here so transform edits do not re-render the list.
 */
export const AppearanceSection = memo(function AppearanceSection({
  base,
  time,
}: {
  base: NodePath
  time: CompTime
}) {
  const t = useT()
  const [stored] = useNodesAt<ShapeItem[]>([base])
  const items = Array.isArray(stored) ? stored : EMPTY
  const [expanded, setExpanded] = useState(false)
  const baseKey = pathKey(base)
  const paints = useMemo(() => collectPaints(items, pathFromKey(baseKey), t), [items, baseKey, t])
  const swatches = useDocumentColors()
  const legacy = useDocument((s) => usesLegacyColorScale(s.doc?.v))
  // Canvas outline of the hovered row; cleared on leave and when the section unmounts under
  // the pointer (clicking a row selects the paint and replaces this view).
  const hovered = useRef<NodePath | null>(null)
  const unhover = () => clearHover(hovered)
  useEffect(() => () => clearHover(hovered), [])
  if (paints.length === 0) return null
  const visible = paints.slice(0, expanded ? EXPANDED_LIMIT : COLLAPSED_COUNT)

  return (
    <Section id="inspector.appearance" title={t.inspector.sections.appearance}>
      {visible.map((paint) => (
        <div
          key={pathKey(paint.path)}
          className="grid min-h-6 grid-cols-[var(--insp-label)_minmax(0,1fr)] items-center gap-2"
          onPointerEnter={() => {
            hovered.current = paint.owner
            setHoverNode(paint.owner)
          }}
          onPointerLeave={unhover}
        >
          <button
            type="button"
            onClick={() => selectNodes([paint.path])}
            className="group/paint flex h-6 min-w-0 items-center gap-1 rounded-sm text-left"
          >
            <span className="flex w-4 shrink-0 justify-center">
              <ShapeTypeIcon
                item={paint.item}
                size={12}
                // Accent = the color is animated (edits add keyframes at the playhead).
                className={
                  isPaintAnimated(paint.item)
                    ? 'text-accent-text'
                    : 'group-hover/paint:text-fg-muted'
                }
              />
            </span>
            <RowLabel
              label={paint.label}
              hint={paint.breadcrumb}
              className="group-hover/paint:text-fg"
            />
          </button>
          {paint.item.ty === 'gf' || paint.item.ty === 'gs' ? (
            <GradientChip
              item={paint.item}
              frame={time.frame}
              label={`${t.inspector.appearance.select}: ${paint.breadcrumb}`}
              onClick={() => selectNodes([paint.path])}
            />
          ) : (
            <PaintColor paint={paint} frame={time.frame} swatches={swatches} legacy={legacy} />
          )}
        </div>
      ))}
      {paints.length > COLLAPSED_COUNT && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-3 w-fit text-fg-subtle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? t.inspector.appearance.showLess
            : t.inspector.appearance.showAll(paints.length)}
        </Button>
      )}
    </Section>
  )
})

/** Clears the canvas hover this section set (another panel may have set its own since). */
function clearHover(hovered: RefObject<NodePath | null>): void {
  if (hovered.current && pathEquals(useUi.getState().hoverNode, hovered.current)) setHoverNode(null)
  hovered.current = null
}

function isPaintAnimated(item: ShapeItem): boolean {
  if (item.ty === 'gf' || item.ty === 'gs') return isAnimated(item.g?.k)
  return isAnimated((item as { c?: { k: unknown } }).c)
}

function PaintColor({
  paint,
  frame,
  swatches,
  legacy,
}: {
  paint: Paint
  frame: number
  swatches: string[]
  legacy: boolean
}) {
  const t = useT()
  const prop = (paint.item as { c?: { k: unknown } }).c
  const value = prop ? evaluateArray(prop, frame) : [0, 0, 0, 1]
  const rgba = decodeColor(value, legacy)
  return (
    <ColorField
      className="w-full"
      value={{ ...rgba, a: 1 }}
      alpha={false}
      swatches={swatches}
      onChange={(c, g) =>
        editProperties(
          t.inspector.history.change(t.inspector.props.color),
          [{ path: [...paint.path, 'c'], frame }],
          (p) => {
            const current = evaluateArray(p, frame)
            writeValue(
              p,
              frame,
              encodeColor(c, decodeColor(current, legacy).a, current.length >= 4 ? 4 : 3, legacy),
            )
          },
          g,
        )
      }
    />
  )
}

function GradientChip({
  item,
  frame,
  label,
  onClick,
}: {
  item: GradientFillShape | GradientStrokeShape
  frame: number
  label: string
  onClick: () => void
}) {
  const stops = parseStops(evaluateArray(item.g?.k, frame), item.g?.p ?? 0)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="h-6 w-full overflow-hidden rounded-sm checkerboard-sm shadow-[inset_0_0_0_1px_var(--le-line-strong)] transition-shadow duration-100 hover:shadow-[inset_0_0_0_1px_var(--le-fg-faint)]"
    >
      <span className="block h-full w-full" style={{ background: cssGradient(stops) }} />
    </button>
  )
}
