/**
 * Display helpers shared by the colors UI: kind icons, hex formatting, row keys and summaries.
 */
import { Layers2, PaintBucket, Spline, Square, SquareFunction, Type } from 'lucide-react'
import type { ComponentType } from 'react'
import type { IconProps } from '@/commands/registry'
import type { Dict } from '@/i18n'
import {
  COLOR_KINDS,
  type ColorGroup,
  type ColorKind,
  type ColorUsage,
  type GradientGroup,
  type GradientKind,
} from '@/lottie/colors'
import { GradientGlyph } from './glyphs'

// Fill and stroke use the layer tree's icons for fill and stroke items.
export const KIND_ICONS: Record<ColorKind, ComponentType<IconProps>> = {
  fill: PaintBucket,
  stroke: Spline,
  gradient: GradientGlyph,
  'text-fill': Type,
  'text-stroke': Type,
  solid: Square,
  effect: SquareFunction,
  style: Layers2,
}

export const GRADIENT_KIND_ICONS: Record<GradientKind, ComponentType<IconProps>> = {
  fill: PaintBucket,
  stroke: Spline,
  style: Layers2,
}

/** Uppercase hex without '#', as shown in rows and fields. */
export const displayHex = (hex: string) => hex.replace('#', '').toUpperCase()

export const percent = (v: number) => `${Math.round(v * 100)}%`

/** Summary used by tooltips: "Fill ×12 · Stroke ×3 · 2 animated · 4 layers". */
export function kindSummary(usages: readonly ColorUsage[], t: Dict, layerCount?: number): string {
  const counts = new Map<ColorKind, number>()
  let animated = 0
  for (const u of usages) {
    counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1)
    if (u.animated) animated++
  }
  const parts = COLOR_KINDS.filter((k) => counts.has(k)).map(
    (k) => `${t.colors.kinds[k]} ×${counts.get(k)}`,
  )
  if (animated) parts.push(t.colors.animatedCount(animated))
  if (layerCount !== undefined) parts.push(t.colors.layers(layerCount))
  return parts.join(' · ')
}

/*
 * Row keys: a group is identified by its sample usage (path based), not by its color, so a row
 * keeps its identity (focus, expansion, popover anchor) while its color is being edited.
 */

export const colorRowKey = (group: ColorGroup) => `c:${group.sample.id}`
export const gradientRowKey = (group: GradientGroup) => `g:${group.sample.id}`
export const stopRowKey = (group: GradientGroup, index: number) =>
  `${gradientRowKey(group)}|s${index}`
export const gradientUsagesKey = (group: GradientGroup) => `${gradientRowKey(group)}|usages`
