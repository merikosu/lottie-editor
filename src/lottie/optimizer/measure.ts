/**
 * Size measurement: minified JSON, gzip (what a web server sends) and a dotLottie container
 * (zip with images stored as files), plus content counts for before / after comparisons.
 */
import { gzipSync, strToU8 } from 'fflate'
import { writeDotLottie } from '../dotlottie'
import { inspectDataUri } from '../stats'
import type { Animation } from '../types'
import {
  arr,
  compLayers,
  forEachPropertyDeep,
  hasExpression,
  isKeyframeList,
  isObj,
  listComps,
  type Json,
} from './model'
import type { ContentCounts, SizeReport } from './types'

/** Fixed zip timestamp: the same document always measures the same. */
const ZIP_TIME = new Date(Date.UTC(2020, 0, 1))

export function gzipBytes(bytes: Uint8Array): number {
  return gzipSync(bytes, { level: 9, mtime: 0 }).length
}

/** Size of the document packaged as a .lottie (dotLottie v1 layout, deflate 9). */
export function dotLottieBytes(anim: Animation): number {
  try {
    return writeDotLottie({
      animations: [{ id: 'animation', data: anim }],
      options: { level: 9, mtime: ZIP_TIME, generator: 'Lottie Editor' },
    }).length
  } catch {
    return 0
  }
}

function countShapes(items: unknown): number {
  let n = 0
  for (const it of arr(items)) {
    if (!isObj(it)) continue
    n++
    if (it.ty === 'gr') n += countShapes(it.it)
  }
  return n
}

function countNumbers(v: unknown): number {
  let n = 0
  const stack: unknown[] = [v]
  while (stack.length) {
    const x = stack.pop()
    if (typeof x === 'number') n++
    else if (Array.isArray(x)) for (const c of x) stack.push(c)
    else if (x !== null && typeof x === 'object') for (const c of Object.values(x)) stack.push(c)
  }
  return n
}

/** Counts of what the document contains. */
export function countContent(anim: Animation): ContentCounts {
  const doc = anim as unknown as Json
  const comps = listComps(doc)
  const counts: ContentCounts = {
    compositions: comps.length - 1,
    layers: 0,
    shapes: 0,
    properties: 0,
    animatedProperties: 0,
    keyframes: 0,
    numbers: countNumbers(doc),
    images: 0,
    imageBytes: 0,
    expressions: 0,
  }
  for (const comp of comps) {
    for (const layer of compLayers(comp)) {
      counts.layers++
      if (layer.ty === 4) counts.shapes += countShapes(layer.shapes)
      forEachPropertyDeep(layer, (prop, text) => {
        counts.properties++
        if (hasExpression(prop)) counts.expressions++
        if (isKeyframeList(prop.k)) {
          counts.animatedProperties++
          counts.keyframes += prop.k.length
        } else if (text && Array.isArray(prop.k)) {
          counts.keyframes += prop.k.length
        }
      })
    }
  }
  for (const a of arr(doc.assets)) {
    if (!isObj(a) || Array.isArray(a.layers) || typeof a.p !== 'string') continue
    counts.images++
    const info = inspectDataUri(a.p)
    if (info) counts.imageBytes += info.bytes
  }
  return counts
}

export interface MeasureOptions {
  /** `JSON.stringify(anim)`, when already available. */
  json?: string
  /** Original text as delivered (whitespace included); measured instead of the minified JSON. */
  source?: string
  /** Compute gzip (default true). */
  gzip?: boolean
  /** Compute the dotLottie size (default true). */
  dotLottie?: boolean
}

/** Sizes (raw, gzip, dotLottie) and content counts of a document. */
export function measure(anim: Animation, opts: MeasureOptions = {}): SizeReport {
  const text = opts.source ?? opts.json ?? JSON.stringify(anim)
  const bytes = strToU8(text)
  return {
    raw: bytes.length,
    gzip: opts.gzip === false ? 0 : gzipBytes(bytes),
    dotLottie: opts.dotLottie === false ? 0 : dotLottieBytes(anim),
    counts: countContent(anim),
  }
}
