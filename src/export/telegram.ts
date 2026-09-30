/**
 * Telegram animated sticker checks (core.telegram.org/stickers): canvas, frame rate, length,
 * compressed size, and the After Effects features Telegram's player does not support.
 *
 * Pure: runs on the document that will be written (with the export fixes applied), so the
 * checklist shows what the sticker will actually contain.
 */
import { hasExpression, isPropertyLike } from '@/lottie/property'
import { forEachLayer, forEachShape } from '@/lottie/traverse'
import type { Animation, Layer } from '@/lottie/types'
import { isImageAsset } from '@/lottie/types'
import { TGS_RULES } from './lottie-files'

export type TgsCheckId =
  | 'size'
  | 'fps'
  | 'duration'
  | 'fileSize'
  | 'expressions'
  | 'masks'
  | 'effects'
  | 'images'
  | 'solids'
  | 'texts'
  | 'threeD'
  | 'mergePaths'
  | 'stars'
  | 'gradientStrokes'
  | 'repeaters'
  | 'timeStretch'
  | 'timeRemap'
  | 'autoOrient'

export type TgsCheckStatus = 'pass' | 'fail' | 'pending'

export interface TgsCheck {
  id: TgsCheckId
  status: TgsCheckStatus
  /** Offending items (layers, shapes, properties) for feature checks. */
  count: number
  /** Names of the first offending layers (for tooltips). */
  layers: string[]
}

export interface TgsReport {
  checks: TgsCheck[]
  /** Checks that fail (pending ones excluded). */
  failures: number
}

/** Feature checks in the order they are listed. */
export const TGS_FEATURES: readonly TgsCheckId[] = [
  'expressions',
  'masks',
  'effects',
  'images',
  'solids',
  'texts',
  'threeD',
  'mergePaths',
  'stars',
  'gradientStrokes',
  'repeaters',
  'timeStretch',
  'timeRemap',
  'autoOrient',
]

const MAX_NAMES = 5

class FeatureCounter {
  readonly counts = new Map<TgsCheckId, number>()
  readonly names = new Map<TgsCheckId, string[]>()

  add(id: TgsCheckId, layerName: string): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1)
    const list = this.names.get(id) ?? []
    if (list.length < MAX_NAMES && !list.includes(layerName)) list.push(layerName)
    this.names.set(id, list)
  }
}

/** Counts properties with expressions below `node` (layers, shapes, masks, effects, text). */
function countExpressions(node: unknown): number {
  let count = 0
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (isPropertyLike(value) && hasExpression(value)) count++
    for (const key in value) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== null && typeof child === 'object') visit(child)
    }
  }
  visit(node)
  return count
}

function nameOf(layer: Layer, index: number): string {
  return typeof layer.nm === 'string' && layer.nm.trim() ? layer.nm : `#${index + 1}`
}

function scanFeatures(doc: Animation): FeatureCounter {
  const counter = new FeatureCounter()
  if (doc.ddd === 1) counter.add('threeD', doc.nm ?? '')
  forEachLayer(doc, (layer, path) => {
    const name = nameOf(layer, Number(path[path.length - 1]))
    const expressions = countExpressions(layer)
    for (let i = 0; i < expressions; i++) counter.add('expressions', name)
    if (
      layer.hasMask ||
      (Array.isArray(layer.masksProperties) && layer.masksProperties.length > 0)
    ) {
      counter.add('masks', name)
    }
    if (Array.isArray(layer.ef) && layer.ef.length > 0) counter.add('effects', name)
    if (layer.ty === 2) counter.add('images', name)
    if (layer.ty === 1) counter.add('solids', name)
    if (layer.ty === 5) counter.add('texts', name)
    if (layer.ddd === 1) counter.add('threeD', name)
    if (layer.ao === 1) counter.add('autoOrient', name)
    if (typeof layer.sr === 'number' && layer.sr !== 0 && Math.abs(layer.sr - 1) > 1e-9)
      counter.add('timeStretch', name)
    if (layer.ty === 0 && layer.tm) counter.add('timeRemap', name)
    if (layer.ty === 4) {
      forEachShape(layer.shapes, [...path, 'shapes'], (item) => {
        if (item.ty === 'mm') counter.add('mergePaths', name)
        else if (item.ty === 'sr') counter.add('stars', name)
        else if (item.ty === 'gs') counter.add('gradientStrokes', name)
        else if (item.ty === 'rp') counter.add('repeaters', name)
      })
    }
  })
  // Image assets nobody uses still ship inside the file.
  const used = new Set<string>()
  forEachLayer(doc, (layer) => {
    if (layer.ty === 2) used.add(layer.refId)
  })
  for (const asset of doc.assets ?? []) {
    if (isImageAsset(asset) && !used.has(asset.id)) counter.add('images', asset.id)
  }
  return counter
}

function basicCheck(id: TgsCheckId, ok: boolean | null): TgsCheck {
  return { id, status: ok === null ? 'pending' : ok ? 'pass' : 'fail', count: 0, layers: [] }
}

/**
 * Checklist for a sticker. `gzipBytes` is the compressed size of the file (null while it is
 * still being computed).
 */
export function checkTelegram(doc: Animation, gzipBytes: number | null): TgsReport {
  const features = scanFeatures(doc)
  const seconds = doc.fr > 0 ? (doc.op - doc.ip) / doc.fr : Infinity
  const checks: TgsCheck[] = [
    basicCheck('size', doc.w === TGS_RULES.width && doc.h === TGS_RULES.height),
    basicCheck('fps', Math.abs(doc.fr - TGS_RULES.fps) < 0.01),
    basicCheck('duration', seconds <= TGS_RULES.maxSeconds + 1e-6),
    basicCheck('fileSize', gzipBytes === null ? null : gzipBytes <= TGS_RULES.maxBytes),
    ...TGS_FEATURES.map<TgsCheck>((id) => {
      const count = features.counts.get(id) ?? 0
      return {
        id,
        status: count > 0 ? 'fail' : 'pass',
        count,
        layers: features.names.get(id) ?? [],
      }
    }),
  ]
  return { checks, failures: checks.filter((c) => c.status === 'fail').length }
}
