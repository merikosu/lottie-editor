/**
 * The document a replacement produces, computed from the document as it was before (so every
 * change of a setting re-applies from scratch instead of stacking up).
 */
import { produce } from 'immer'
import { hexToRgba } from '@/lib/color'
import type { Box } from '@/lottie/bounds'
import { getAt, type NodePath } from '@/lottie/path'
import {
  replaceTargetKind,
  replaceWithImage,
  replaceWithShapes,
  type FitMode,
  type ReplaceOptions,
  type ReplaceResult,
  type ReplaceStyle,
  type ReplaceWarning,
} from '@/lottie/replace'
import { forEachLayer } from '@/lottie/traverse'
import type { Animation, ShapeItem } from '@/lottie/types'
import { instancesOf, sharedAssetOf } from '../lib/targets'

/** How new vector content is colored. */
export type StyleChoice = 'keep' | 'original' | 'color'

export interface ReplaceSettings {
  fit: FitMode
  /** Extra scale in percent (100 = as fitted). */
  scale: number
  /** Offset in percent of the element's width / height. */
  offsetX: number
  offsetY: number
  style: StyleChoice
  /** Color of the 'color' style (#rrggbb). */
  color: string
  /** Replace every layer that shows the same image or composition. */
  everywhere: boolean
}

export const DEFAULT_SETTINGS: ReplaceSettings = {
  fit: 'contain',
  scale: 100,
  offsetX: 0,
  offsetY: 0,
  style: 'keep',
  color: '#ffffff',
  everywhere: true,
}

/** What goes in: vector shapes (an imported SVG) or an embedded image. */
export type ReplaceContent =
  | { kind: 'shapes'; name: string; shapes: ShapeItem[] }
  | { kind: 'image'; name: string; dataUri: string; w: number; h: number }

export interface ReplaceInput {
  target: NodePath
  content: ReplaceContent
  settings: ReplaceSettings
  /** Reference frame of the target (its resting state). */
  frame: number
  /** The target's bounds at `frame` (offsets are relative to its size). */
  box: Box | null
}

export interface ReplaceOutput {
  doc: Animation
  /** The target after the replacement (asset indices may have moved). */
  target: NodePath
  warnings: ReplaceWarning[]
  /** Number of layers that were replaced. */
  instances: number
}

function styleOf(settings: ReplaceSettings): ReplaceStyle {
  if (settings.style === 'original') return 'original'
  if (settings.style === 'color') {
    const c = hexToRgba(settings.color) ?? { r: 1, g: 1, b: 1, a: 1 }
    const color = { ...c, a: 1 }
    return { fill: color, stroke: color, outline: false }
  }
  return 'keep'
}

/** Engine options for the settings. */
export function replaceOptions(input: Omit<ReplaceInput, 'target'>): ReplaceOptions {
  const { settings, box } = input
  const scale = settings.scale > 0 ? settings.scale / 100 : 1
  return {
    fit: settings.fit,
    frame: input.frame,
    adjust: {
      scale,
      dx: box ? (settings.offsetX / 100) * box.w : 0,
      dy: box ? (settings.offsetY / 100) * box.h : 0,
    },
    style: styleOf(settings),
    name: input.content.name,
  }
}

function isUsed(anim: Animation, assetId: string): boolean {
  let used = false
  forEachLayer(anim, (layer) => {
    if ((layer as { refId?: string }).refId === assetId) {
      used = true
      return false
    }
  })
  return used
}

/** Index adjustment after removing asset `removed`: paths into later assets move up by one. */
function shiftPath(path: NodePath, removed: number): NodePath {
  if (path[0] !== 'assets' || typeof path[1] !== 'number' || path[1] <= removed) return path
  return ['assets', path[1] - 1, ...path.slice(2)]
}

/**
 * Applies the replacement to a copy of `base` (which is not changed):
 *  - a shared composition is replaced for every layer showing it (`everywhere`), or cloned for
 *    this layer only;
 *  - with `everywhere`, every image layer showing the target's image is replaced, and a new
 *    image is embedded once;
 *  - an image nothing shows any more is removed, so the old picture does not stay hidden in
 *    the file.
 * Throws the engine's `ReplaceError` for invalid targets or content.
 */
export function computeReplace(base: Animation, input: ReplaceInput): ReplaceOutput {
  const warnings = new Set<ReplaceWarning>()
  let target = input.target
  let instances = 0
  const doc = produce(base, (draft) => {
    const d = draft as Animation
    const kind = replaceTargetKind(d, input.target)
    const everywhere = input.settings.everywhere
    const oldAsset = kind === 'image-layer' ? sharedAssetOf(d, input.target) : null
    const targets =
      everywhere && kind === 'image-layer' ? instancesOf(d, input.target) : [input.target]
    const opts = replaceOptions(input)
    if (kind === 'precomp-layer') opts.detach = !everywhere
    const created: string[] = []
    targets.forEach((path, i) => {
      // Other instances show the same image: they share the fit, but rest at their own frames.
      const o: ReplaceOptions = i === 0 ? opts : { ...opts, frame: undefined }
      const content = input.content
      const r: ReplaceResult =
        content.kind === 'shapes'
          ? replaceWithShapes(d, path, { shapes: content.shapes }, o)
          : replaceWithImage(
              d,
              path,
              { dataUri: content.dataUri, w: content.w, h: content.h, name: content.name },
              o,
            )
      for (const w of r.warnings) warnings.add(w)
      // A group replaced by an image becomes a new image layer: follow it.
      if (i === 0) target = r.paths[0] ?? input.target
      if (content.kind === 'image') {
        const assetPath = r.paths[r.paths.length - 1]
        const id = getAt<{ id?: string }>(d, assetPath)?.id
        if (id) created.push(id)
      }
    })
    instances = targets.length

    // One embedded copy of the new image, whatever the number of layers showing it.
    if (created.length > 1) {
      const [keep, ...extra] = created
      const drop = new Set(extra)
      forEachLayer(d, (layer) => {
        const l = layer as { refId?: string }
        if (l.refId && drop.has(l.refId)) l.refId = keep
      })
      d.assets = (d.assets ?? []).filter((a) => !drop.has(a.id))
    }

    if (oldAsset && !isUsed(d, oldAsset)) {
      const index = (d.assets ?? []).findIndex((a) => a.id === oldAsset)
      if (index >= 0) {
        d.assets!.splice(index, 1)
        target = shiftPath(target, index)
      }
    }
  })
  return { doc, target, warnings: [...warnings], instances }
}
