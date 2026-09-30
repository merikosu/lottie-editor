/**
 * `analyze`: a quick dry run for the UI before optimizing — what each technique would change and
 * roughly how many bytes it would save (raw JSON, in pipeline order; gzip is not measured).
 * Images are counted but not re-encoded.
 */
import { strToU8 } from 'fflate'
import type { Animation } from '../types'
import { measure } from './measure'
import { buildContext, type Json } from './model'
import { resolveOptions, TECHNIQUES } from './presets'
import { STEPS, Warnings, workingCopy } from './pipeline'
import type { TechniqueContext } from './techniques/context'
import type {
  Analysis,
  ImageReport,
  OptimizeOptionsInput,
  TechniqueEstimate,
  TechniqueId,
} from './types'

export function analyze(anim: Animation | string, input?: OptimizeOptionsInput): Analysis {
  const options = resolveOptions(input)
  const doc: Json = workingCopy(anim)
  let json = JSON.stringify(doc)
  const size = measure(doc as unknown as Animation, {
    json,
    source: typeof anim === 'string' ? anim : undefined,
    dotLottie: false,
  })
  const info = buildContext(doc)
  const warnings = new Warnings()
  if (info.expressions > 0) warnings.add('expressions', info.expressions)
  if (info.legacyColors || info.legacyClosed)
    warnings.add('legacyFormat', undefined, String(doc.v ?? ''))
  if (info.slots > 0) warnings.add('slots', info.slots)
  if (info.threeD) warnings.add('threeD')
  const techniques: Partial<Record<TechniqueId, TechniqueEstimate>> = {}
  let raw = size.raw
  const images: ImageReport[] = []
  const spent = new WeakMap<object, number>()
  for (const { id } of TECHNIQUES) {
    if (!options.techniques[id] || id === 'images') continue
    const tc: TechniqueContext = {
      doc,
      info,
      options,
      images,
      spent,
      warn: (code, count, detail) => warnings.add(code, count, detail),
    }
    const details = STEPS[id](tc)
    if (details instanceof Promise) continue
    const changes = Object.values(details).reduce((sum, n) => sum + n, 0)
    if (changes === 0 && id !== 'minify') continue
    json = JSON.stringify(doc)
    const next = strToU8(json).length
    techniques[id] = { changes, details, savedRaw: raw - next }
    raw = next
  }
  return {
    size,
    techniques,
    estimatedRaw: raw,
    images: size.counts.images,
    imageBytes: size.counts.imageBytes,
    expressions: info.expressions,
    version: typeof doc.v === 'string' ? doc.v : undefined,
    warnings: warnings.list,
  }
}
