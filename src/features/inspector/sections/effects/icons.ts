/**
 * Icons of the effects the editor adds (menus and commands). Lucide only, so the command
 * registration can import it at startup.
 */
import {
  Brush,
  Copy,
  Droplet,
  Move,
  PaintBucket,
  Palette,
  SwatchBook,
  type LucideIcon,
} from 'lucide-react'
import type { AddableEffectKind } from '@/lottie/effects'

export const EFFECT_ICONS: Readonly<Record<AddableEffectKind, LucideIcon>> = {
  fill: PaintBucket,
  tint: Palette,
  tritone: SwatchBook,
  // Two offset squares: the classic drop shadow glyph.
  dropShadow: Copy,
  // A drop, like the blur tool of image editors.
  gaussianBlur: Droplet,
  stroke: Brush,
  transform: Move,
}
