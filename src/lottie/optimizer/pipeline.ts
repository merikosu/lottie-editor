/**
 * The optimization pipeline: clone → run the enabled techniques in order → measure after each
 * step → report.
 *
 * Sizes are measured on the minified JSON after every step (raw, and gzip unless disabled), so
 * each step's saving is the difference it made at its position in the pipeline and the savings
 * add up to the total. The input is never modified.
 */
import { strToU8 } from 'fflate'
import type { Animation } from '../types'
import { dotLottieBytes, gzipBytes, measure } from './measure'
import { buildContext, type Json } from './model'
import { resolveOptions, techniqueCategory, TECHNIQUES } from './presets'
import { legacy } from './techniques/legacy'
import { hidden, invisible, empty } from './techniques/structure'
import { unusedAssets, dedupeAssets } from './techniques/assets'
import { staticize } from './techniques/staticize'
import { keyframes } from './techniques/keyframes'
import { paths } from './techniques/paths'
import { precision } from './techniques/precision'
import { defaults } from './techniques/defaults'
import { names } from './techniques/names'
import { images } from './techniques/images'
import { throwIfAborted, type TechniqueContext, type TechniqueFn } from './techniques/context'
import type {
  ImageReport,
  OptimizeHooks,
  OptimizeOptionsInput,
  OptimizeResult,
  OptimizeWarning,
  OptimizeWarningCode,
  StepReport,
  TechniqueId,
} from './types'

/** Technique implementations by id (all synchronous except `images`). */
export const STEPS: Readonly<Record<TechniqueId, TechniqueFn>> = {
  // Serialization is what `minify` does: nothing to change in the object.
  minify: () => ({}),
  legacy,
  hidden,
  invisible,
  empty,
  unusedAssets,
  dedupeAssets,
  staticize,
  keyframes,
  paths,
  precision,
  defaults,
  names,
  images,
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Lets the event loop breathe between steps (progress messages, cancellation, UI). */
const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Collects warnings, merging repeated codes (counts add up). */
export class Warnings {
  readonly list: OptimizeWarning[] = []
  add(code: OptimizeWarningCode, count?: number, detail?: string): OptimizeWarning {
    const existing = this.list.find((w) => w.code === code)
    if (existing) {
      if (count !== undefined) existing.count = (existing.count ?? 0) + count
      return existing
    }
    const w: OptimizeWarning = {
      code,
      ...(count !== undefined ? { count } : {}),
      ...(detail ? { detail } : {}),
    }
    this.list.push(w)
    return w
  }
}

/** Parses a document or clones an object (the pipeline never touches its input). */
export function workingCopy(anim: Animation | string): Json {
  return JSON.parse(typeof anim === 'string' ? anim : JSON.stringify(anim)) as Json
}

/**
 * Optimizes a copy of `anim` (an object or its JSON text). Resolves with the optimized animation,
 * its minified JSON and the report; rejects with an `AbortError` when `hooks.signal` aborts.
 */
export async function optimizeAnimation(
  anim: Animation | string,
  input?: OptimizeOptionsInput,
  hooks: OptimizeHooks = {},
): Promise<OptimizeResult> {
  const started = now()
  const options = resolveOptions(input)
  const { signal, onProgress } = hooks
  const measureGzip = hooks.measureGzip !== false
  throwIfAborted(signal)

  const doc = workingCopy(anim)
  const source = hooks.source ?? (typeof anim === 'string' ? anim : undefined)
  let json = JSON.stringify(doc)
  const before = measure(doc as unknown as Animation, { json, source, gzip: measureGzip })
  // Sizes of the running document; the first step (minify) compares against `before`.
  let raw = before.raw
  let gzip = before.gzip

  const info = buildContext(doc)
  const warnings = new Warnings()
  if (info.expressions > 0) warnings.add('expressions', info.expressions)
  if (info.legacyColors || info.legacyClosed)
    warnings.add('legacyFormat', undefined, String(doc.v ?? ''))
  if (info.slots > 0) warnings.add('slots', info.slots)
  if (info.threeD) warnings.add('threeD')

  const enabled = TECHNIQUES.filter((t) => options.techniques[t.id])
  const imageReports: ImageReport[] = []
  const spent = new WeakMap<object, number>()
  const steps: StepReport[] = []
  const total = enabled.length + 1
  for (let index = 0; index < enabled.length; index++) {
    const { id } = enabled[index]
    throwIfAborted(signal)
    onProgress?.(id, index, total)
    const stepWarnings: OptimizeWarning[] = []
    const tc: TechniqueContext = {
      doc,
      info,
      options,
      images: imageReports,
      spent,
      signal,
      warn: (code, count, detail) => {
        const w = warnings.add(code, count, detail)
        if (!stepWarnings.includes(w)) stepWarnings.push(w)
      },
    }
    const t0 = now()
    const details = await STEPS[id](tc)
    const changes = Object.values(details).reduce((sum, n) => sum + n, 0)
    let savedRaw = 0
    let savedGzip = 0
    // `minify` only matters when the source text had whitespace (it is the serialization).
    const reformatted = id === 'minify' && source !== undefined && source !== json
    if (changes > 0 || reformatted) {
      json = JSON.stringify(doc)
      const bytes = strToU8(json)
      savedRaw = raw - bytes.length
      raw = bytes.length
      if (measureGzip) {
        const g = gzipBytes(bytes)
        savedGzip = gzip - g
        gzip = g
      }
    }
    steps.push({
      id,
      category: techniqueCategory(id),
      savedRaw,
      savedGzip,
      changes,
      details,
      warnings: stepWarnings,
      ms: Math.round(now() - t0),
    })
    await yieldToLoop()
  }

  throwIfAborted(signal)
  onProgress?.('measure', enabled.length, total)
  const animation = doc as unknown as Animation
  const after = { ...measure(animation, { json, gzip: false, dotLottie: false }), gzip, raw }
  after.dotLottie = dotLottieBytes(animation)
  onProgress?.('measure', total, total)
  return {
    animation,
    json,
    report: {
      before,
      after,
      steps,
      warnings: warnings.list,
      images: imageReports,
      options,
      durationMs: Math.round(now() - started),
    },
  }
}
