/**
 * Icon and label-color maps for layer kinds and shape items (see icons.tsx for components).
 */
import {
  Blend,
  Box,
  Circle,
  Combine,
  Crosshair,
  Hexagon,
  Image as ImageIcon,
  Layers,
  Move3d,
  PaintBucket,
  PenTool,
  Repeat2,
  Scissors,
  Shapes,
  Spline,
  Square,
  SquareDashed,
  Star,
  Tornado,
  Type,
  Video,
  Volume2,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import type { LayerKind } from '@/lottie/layers'
import type { ShapeItem } from '@/lottie/types'

export const LAYER_KIND_ICONS: Record<LayerKind, LucideIcon> = {
  precomp: Layers,
  solid: Square,
  image: ImageIcon,
  null: Crosshair,
  shape: Shapes,
  text: Type,
  audio: Volume2,
  camera: Video,
  adjustment: Blend,
  other: Box,
}

/** Tailwind text color class for a layer kind (label colors, as in After Effects). */
export const LAYER_KIND_TEXT: Record<LayerKind, string> = {
  precomp: 'text-label-precomp',
  solid: 'text-label-solid',
  image: 'text-label-image',
  null: 'text-label-null',
  shape: 'text-label-shape',
  text: 'text-label-text',
  audio: 'text-label-other',
  camera: 'text-label-other',
  adjustment: 'text-label-other',
  other: 'text-label-other',
}

/** Tailwind background color class for a layer kind (timeline bars, dots). */
export const LAYER_KIND_BG: Record<LayerKind, string> = {
  precomp: 'bg-label-precomp',
  solid: 'bg-label-solid',
  image: 'bg-label-image',
  null: 'bg-label-null',
  shape: 'bg-label-shape',
  text: 'bg-label-text',
  audio: 'bg-label-other',
  camera: 'bg-label-other',
  adjustment: 'bg-label-other',
  other: 'bg-label-other',
}

export const SHAPE_ICONS: Record<string, LucideIcon> = {
  gr: SquareDashed,
  sh: PenTool,
  rc: Square,
  el: Circle,
  sr: Star,
  fl: PaintBucket,
  st: Spline,
  gf: PaintBucket,
  gs: Spline,
  tr: Move3d,
  tm: Scissors,
  rp: Repeat2,
  rd: Circle,
  mm: Combine,
  op: Waves,
  pb: Hexagon,
  tw: Tornado,
  zz: Waves,
  no: Box,
}

export function shapeIcon(item: Pick<ShapeItem, 'ty'> | { ty: string }): LucideIcon {
  if (item.ty === 'sr' && (item as { sy?: number }).sy === 2) return Hexagon
  return Object.hasOwn(SHAPE_ICONS, item.ty) ? SHAPE_ICONS[item.ty] : Box
}
