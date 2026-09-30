/**
 * Icon slot of a tree row: layer kind (in its label color), a color swatch for fills and
 * strokes (a ring for strokes, split diagonally when the color is animated), a gradient
 * swatch for gradients, or the shape item's type icon.
 */
import type { CSSProperties } from 'react'
import { LayerKindIcon, ShapeTypeIcon } from '@/components/lottie/icons'
import { cn } from '@/lib/cn'
import { lottieToRgba } from '@/lib/color'
import { layerKind } from '@/lottie/layers'
import { getKeyframes, staticValue, type AnyProperty } from '@/lottie/property'
import type { GradientColors, Layer, ShapeItem } from '@/lottie/types'

const css = (arr: readonly number[] | undefined) => {
  const c = lottieToRgba(arr ?? [0, 0, 0])
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`
}

/** First and last values of a (possibly animated) color property. */
function colorEnds(prop: AnyProperty | undefined): [string, string] | null {
  if (!prop) return null
  const kfs = getKeyframes<number[]>(prop)
  if (!kfs) {
    const v = prop.k
    return Array.isArray(v) && typeof v[0] === 'number'
      ? [css(v as number[]), css(v as number[])]
      : null
  }
  const first = kfs[0]?.s ?? kfs[0]?.e
  let lastValue = kfs[kfs.length - 1]?.s
  for (let i = kfs.length - 2; !lastValue && i >= 0; i--) lastValue = kfs[i].e ?? kfs[i].s
  return first ? [css(first), css(lastValue ?? first)] : null
}

/** CSS gradient approximating a Lottie gradient (color stops; matching opacity stops as alpha). */
function gradientCss(g: GradientColors | undefined, radial: boolean): string | null {
  if (!g || typeof g.p !== 'number') return null
  const raw = staticValue(g.k as AnyProperty)
  if (!Array.isArray(raw)) return null
  const k = raw as number[]
  const n = Math.max(0, Math.min(g.p, Math.floor(k.length / 4)))
  if (n === 0) return null
  const alpha = (k.length - n * 4) / 2 === n ? (i: number) => k[n * 4 + i * 2 + 1] ?? 1 : () => 1
  const stops = Array.from({ length: n }, (_, i) => {
    const c = lottieToRgba([k[i * 4 + 1], k[i * 4 + 2], k[i * 4 + 3]])
    const rgb = `${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)}`
    return `rgb(${rgb} / ${Math.max(0, Math.min(1, alpha(i)))}) ${Math.round((k[i * 4] ?? 0) * 100)}%`
  })
  return radial
    ? `radial-gradient(circle, ${stops.join(', ')})`
    : `linear-gradient(90deg, ${stops.join(', ')})`
}

/** Punches out the middle of an element, leaving a 2.5px ring (stroke swatches). */
const RING: CSSProperties = {
  padding: 2.5,
  WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
  WebkitMaskComposite: 'xor',
  mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
}

function Swatch({ background, ring, dim }: { background: string; ring: boolean; dim?: boolean }) {
  return (
    <span className={cn('relative block size-3 shrink-0', dim && 'opacity-40')}>
      <span
        className="absolute inset-0 rounded-[3px] checkerboard-sm"
        style={ring ? RING : undefined}
      />
      <span
        className="absolute inset-0 rounded-[3px]"
        style={{ background, ...(ring ? RING : null) }}
      />
      <span className="absolute inset-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]" />
    </span>
  )
}

export function NodeIcon({
  node,
  kind,
  dim,
}: {
  node: Layer | ShapeItem
  kind: 'layer' | 'shape'
  dim?: boolean
}) {
  if (kind === 'layer') {
    return <LayerKindIcon kind={layerKind(node as Layer)} className={cn(dim && 'opacity-40')} />
  }
  const item = node as ShapeItem
  if (item.ty === 'fl' || item.ty === 'st') {
    const ends = colorEnds(item.c)
    if (ends) {
      const background =
        ends[0] === ends[1] ? ends[0] : `linear-gradient(135deg, ${ends[0]} 50%, ${ends[1]} 50%)`
      return <Swatch background={background} ring={item.ty === 'st'} dim={dim} />
    }
  }
  if (item.ty === 'gf' || item.ty === 'gs') {
    const background = gradientCss(item.g, item.t === 2)
    if (background) return <Swatch background={background} ring={item.ty === 'gs'} dim={dim} />
  }
  return <ShapeTypeIcon item={item} className={cn(dim && 'opacity-40')} />
}
