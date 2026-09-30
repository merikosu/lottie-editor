/**
 * Human-readable descriptions of where a color is used: a breadcrumb of the nodes that hold
 * it ("Comp › Layer › Group › Fill") and a short detail ("Key 2", "Stop 1 at 50%").
 */
import { nodeBreadcrumb } from '@/components/lottie/labels'
import { nameText } from '@/features/inspector/model/names'
import type { Dict } from '@/i18n'
import type { ColorUsage, GradientUsage } from '@/lottie/colors'
import { getAt, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'

export interface UsageDescription {
  /** Breadcrumb parts, outermost first. */
  crumbs: string[]
  /** What holds the color (fill, text stroke, effect…). */
  kind: string
  /** Keyframe / stop details, may be empty. */
  detail: string
}

const percent = (v: number) => `${Math.round(v * 100)}%`

function nameAt(doc: Animation, path: NodePath): string | undefined {
  const node = getAt<{ nm?: unknown }>(doc, path)
  return typeof node?.nm === 'string' && node.nm.trim() ? node.nm.trim() : undefined
}

/** Names of the effect, effect groups and control between the layer and the color value. */
function innerCrumbs(doc: Animation, layerPath: NodePath, path: NodePath): string[] {
  const crumbs: string[] = []
  const rest = path.slice(layerPath.length)
  if (rest[0] === 'ef' || rest[0] === 'sy' || (rest[0] === 't' && rest[1] === 'a')) {
    // Every [container, index] pair below the layer names one level (effect, value, style, animator).
    const start = rest[0] === 't' ? 1 : 0
    for (let i = start; i + 1 < rest.length; i++) {
      if (typeof rest[i + 1] !== 'number') continue
      const name = nameAt(doc, [...layerPath, ...rest.slice(0, i + 2)])
      if (name) crumbs.push(name)
    }
  }
  return crumbs
}

function compCrumb(doc: Animation, layerPath: NodePath): string[] {
  if (layerPath[0] !== 'assets' || typeof layerPath[1] !== 'number') return []
  const asset = getAt<{ nm?: string; id?: string }>(doc, ['assets', layerPath[1]])
  const name = nameText(asset?.nm) || asset?.id
  return name ? [name] : []
}

function keyframeDetail(
  t: Dict,
  u: { keyframeIndex?: number; end?: boolean; animated: boolean },
): string {
  if (u.keyframeIndex === undefined || !u.animated) return ''
  return u.end
    ? t.colors.usage.endValue(u.keyframeIndex + 1)
    : t.colors.usage.keyframe(u.keyframeIndex + 1)
}

export function describeUsage(doc: Animation, u: ColorUsage, t: Dict): UsageDescription {
  const crumbs = [
    ...compCrumb(doc, u.layerPath),
    ...nodeBreadcrumb(doc, u.nodePath, t),
    ...innerCrumbs(doc, u.layerPath, u.path),
  ]
  const details: string[] = []
  const key = keyframeDetail(t, u)
  if (key) details.push(key)
  if (u.stopIndex !== undefined) {
    details.push(
      `${t.colors.usage.stop(u.stopIndex + 1)} ${t.colors.usage.position(percent(u.stopOffset ?? 0))}`,
    )
  }
  return { crumbs, kind: t.colors.kinds[u.kind], detail: details.join(' · ') }
}

export function describeGradientUsage(doc: Animation, g: GradientUsage, t: Dict): UsageDescription {
  const crumbs = [...compCrumb(doc, g.layerPath), ...nodeBreadcrumb(doc, g.nodePath, t)]
  if (g.kind === 'style') crumbs.push(...innerCrumbs(doc, g.layerPath, g.path))
  return { crumbs, kind: t.colors.gradientKinds[g.kind], detail: keyframeDetail(t, g) }
}
