/**
 * Layer-level edits used by the inspector (pure; they mutate drafts inside `updateDoc`).
 */
import { findLayerIndexByInd, nextLayerInd, parentChain } from '@/lottie/layers'
import { getKeyframes } from '@/lottie/property'
import { forEachProperty } from '@/lottie/traverse'
import type { Layer, PrecompLayer } from '@/lottie/types'
import { roundTo } from '@/lib/math'

const roundTime = (v: number) => roundTo(v, 3)

/** Remaps the time of every keyframe the layer owns (not the content of a precomp). */
function remapLayerKeyframes(layer: Layer, map: (t: number) => number): void {
  forEachProperty(layer, [], (prop) => {
    for (const kf of getKeyframes(prop) ?? []) kf.t = roundTime(map(kf.t))
  })
}

/* -------------------------------------------------------------------------- */
/*                                    Time                                    */
/* -------------------------------------------------------------------------- */

/**
 * Moves a layer in time by `delta` frames: in/out/start and every keyframe the layer owns
 * (transform, shapes, masks, effects, text, time remap). A precomp's content moves along
 * because its start time moves; the composition itself is not touched.
 */
export function moveLayerInTime(layer: Layer, delta: number): void {
  if (!Number.isFinite(delta) || delta === 0) return
  layer.ip = roundTime(layer.ip + delta)
  layer.op = roundTime(layer.op + delta)
  layer.st = roundTime((layer.st ?? 0) + delta)
  remapLayerKeyframes(layer, (t) => t + delta)
}

/**
 * Sets the time stretch (`sr`, 1 = 100%) the way After Effects does: the layer's in/out
 * points and its own keyframes scale around the start time. Values ≤ 0 are ignored.
 */
export function setLayerStretch(layer: Layer, stretch: number): void {
  if (!Number.isFinite(stretch) || stretch <= 0) return
  const old = layer.sr && layer.sr > 0 ? layer.sr : 1
  const factor = stretch / old
  if (factor === 1) return
  const st = layer.st ?? 0
  layer.ip = roundTime(st + (layer.ip - st) * factor)
  layer.op = roundTime(st + (layer.op - st) * factor)
  remapLayerKeyframes(layer, (t) => st + (t - st) * factor)
  layer.sr = roundTo(stretch, 4)
}

/**
 * Turns on time remapping for a precomp layer without changing what it shows: two linear
 * keyframes (seconds of content time) at the in and out points.
 */
export function enableTimeRemap(layer: PrecompLayer, fps: number): void {
  if (layer.tm || !(fps > 0)) return
  const sr = layer.sr && layer.sr > 0 ? layer.sr : 1
  const st = layer.st ?? 0
  const seconds = (t: number) => roundTo((t - st) / sr / fps, 4)
  const keys: PrecompLayer['tm'] = {
    a: 1,
    k: [
      {
        t: layer.ip,
        s: [seconds(layer.ip)],
        o: { x: [0.167], y: [0.167] },
        i: { x: [0.833], y: [0.833] },
      },
      { t: layer.op, s: [seconds(layer.op)] },
    ],
  }
  layer.tm = keys
}

export function disableTimeRemap(layer: PrecompLayer): void {
  delete layer.tm
}

/* -------------------------------------------------------------------------- */
/*                                  Parenting                                 */
/* -------------------------------------------------------------------------- */

/** Indices of layers that can become the parent of `layers[index]` (no self, no cycles). */
export function parentCandidates(layers: readonly Layer[], index: number): number[] {
  const self = layers[index]
  if (!self) return []
  const out: number[] = []
  layers.forEach((layer, i) => {
    if (i !== index && !parentChain(layers, layer).includes(self)) out.push(i)
  })
  return out
}

/**
 * Sets (or clears, with null) the parent of `layers[index]`. The parent gets an `ind` when it
 * has none. Refuses parents that would create a cycle.
 */
export function setLayerParent(layers: Layer[], index: number, parentIndex: number | null): void {
  const layer = layers[index]
  if (!layer) return
  if (parentIndex === null) {
    delete layer.parent
    return
  }
  const parent = layers[parentIndex]
  if (!parent || parentIndex === index || parentChain(layers, parent).includes(layer)) return
  if (typeof parent.ind !== 'number') parent.ind = nextLayerInd(layers)
  layer.parent = parent.ind
}

/* -------------------------------------------------------------------------- */
/*                                Track mattes                                */
/* -------------------------------------------------------------------------- */

/** 0 none, 1 alpha, 2 alpha inverted, 3 luma, 4 luma inverted. */
export type MatteMode = 0 | 1 | 2 | 3 | 4

/**
 * Index of the layer used as the track matte of `layers[index]`: the layer referenced by
 * `tp` (newer files) or the matte layer (`td`) directly above. -1 when there is none.
 */
export function matteSourceIndex(layers: readonly Layer[], index: number): number {
  const layer = layers[index]
  if (!layer?.tt) return -1
  if (typeof layer.tp === 'number') return findLayerIndexByInd(layers, layer.tp)
  const above = layers[index - 1]
  return above?.td ? index - 1 : -1
}

/** Layers that use `layers[index]` as their track matte. */
export function matteTargets(layers: readonly Layer[], index: number): number[] {
  if (!layers[index]?.td) return []
  const out: number[] = []
  layers.forEach((l, i) => {
    if (l.tt && matteSourceIndex(layers, i) === index) out.push(i)
  })
  return out
}

/** True when a track matte can be set on `layers[index]` (it needs a layer above it). */
export function canSetTrackMatte(layers: readonly Layer[], index: number): boolean {
  return matteSourceIndex(layers, index) >= 0 || index > 0
}

/**
 * Sets the track matte mode of `layers[index]`. A new matte uses the layer directly above
 * (which becomes a matte layer, `td`). Removing the matte turns the source back into a
 * normal layer but hides it (like After Effects), so the picture only changes for the
 * target layer.
 */
export function setTrackMatte(layers: Layer[], index: number, mode: MatteMode): void {
  const layer = layers[index]
  if (!layer) return
  const source = matteSourceIndex(layers, index)
  if (mode === 0) {
    delete layer.tt
    delete layer.tp
    if (source >= 0 && matteTargets(layers, source).length === 0) {
      const src = layers[source]
      delete src.td
      src.hd = true
    }
    return
  }
  if (source >= 0) {
    layer.tt = mode
    return
  }
  const above = layers[index - 1]
  if (!above) return
  layer.tt = mode
  above.td = 1
}
