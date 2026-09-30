/**
 * The optimizer pipeline end to end: presets, report arithmetic, input immutability, abort,
 * analysis, format recommendation, the worker client's main-thread fallback — and the core
 * guarantee on real files: every preset produces a structurally valid document that draws the
 * same scene (within its tolerance) at every sampled frame.
 */
import { freeze } from 'immer'
import { describe, expect, it } from 'vitest'
import { analyze } from '../optimizer/analyze'
import { createOptimizerClient } from '../optimizer/client'
import { measure } from '../optimizer/measure'
import { optimizeAnimation } from '../optimizer/pipeline'
import { matchPreset, PRESETS, resolveOptions, TECHNIQUE_IDS } from '../optimizer/presets'
import { recommendFormat, totalSaved } from '../optimizer/report'
import { describeMismatches, verifySemantic } from '../optimizer/semantic'
import { nextBackoff, visualFrames } from '../optimizer/visual'
import type { PresetId } from '../optimizer/types'
import type { Animation } from '../types'
import {
  bakedAnimation,
  doc,
  fill,
  group,
  legacyAnimation,
  rect,
  shapeLayer,
} from './fixtures/optimizer/builders'
import { structureProblems } from './fixtures/optimizer/harness'

/**
 * Real-world files, loaded with Vite's glob import: files that do not exist (the user's
 * documents in docs/ are optional) are simply absent, and their tests are skipped.
 */
const SOURCES = {
  ...import.meta.glob('../../samples/*.json', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('./fixtures/optimizer/*.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('../../../docs/*.json', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

const REAL_FILES = [
  '../../samples/bounce.json',
  '../../samples/gradient-blob.json',
  '../../samples/like.json',
  '../../samples/loader.json',
  '../../samples/orbit.json',
  '../../samples/success.json',
  '../../samples/toggle.json',
  '../../samples/typing.json',
  './fixtures/optimizer/legacy-gatin.json',
  './fixtures/optimizer/legacy-adrock.json',
  '../../../docs/test.json',
  '../../../docs/wallet_flag.json',
]

const exists = (rel: string) => typeof SOURCES[rel] === 'string'
const load = (rel: string) => SOURCES[rel]

/** Scene tolerances per preset: the preset's budgets plus slack for float noise. */
const TOLERANCE: Record<PresetId, { geometry: number; color: number; opacity: number }> = {
  safe: { geometry: 2e-3, color: 1e-6, opacity: 1e-6 },
  balanced: { geometry: 0.06, color: 0.0021, opacity: 0.0011 },
  maximum: { geometry: 0.24, color: 0.0041, opacity: 0.0041 },
}

describe('presets', () => {
  it('resolves ids, partial overrides and clamps', () => {
    expect(resolveOptions()).toEqual(PRESETS.balanced)
    expect(resolveOptions('maximum')).toEqual(PRESETS.maximum)
    const o = resolveOptions({
      preset: 'safe',
      pxTolerance: -3,
      techniques: { minify: false, names: true },
      image: { quality: 7 },
    })
    expect(o.pxTolerance).toBe(0)
    expect(o.techniques.minify).toBe(true)
    expect(o.techniques.names).toBe(true)
    expect(o.image.quality).toBe(1)
    expect(matchPreset(resolveOptions('safe'))).toBe('safe')
    expect(matchPreset(o)).toBeNull()
  })

  it('safe is lossless only and every preset lists every technique', () => {
    for (const id of ['safe', 'balanced', 'maximum'] as PresetId[])
      expect(Object.keys(PRESETS[id].techniques).sort()).toEqual([...TECHNIQUE_IDS].sort())
    expect(PRESETS.safe.pxTolerance).toBe(0)
    expect(PRESETS.safe.techniques.precision).toBe(false)
    expect(PRESETS.safe.techniques.images).toBe(false)
    expect(PRESETS.safe.techniques.names).toBe(false)
    expect(PRESETS.balanced.techniques.names).toBe(false)
  })
})

describe('report', () => {
  it('step savings add up to the total (raw and gzip), sizes match the JSON', async () => {
    const text = JSON.stringify(bakedAnimation(200), null, 2)
    const { json, report } = await optimizeAnimation(text, 'balanced')
    const sum = (k: 'savedRaw' | 'savedGzip') => report.steps.reduce((s, x) => s + x[k], 0)
    expect(sum('savedRaw')).toBe(report.before.raw - report.after.raw)
    expect(sum('savedGzip')).toBe(report.before.gzip - report.after.gzip)
    expect(report.after.raw).toBe(new TextEncoder().encode(json).length)
    // The source text was pretty-printed: minify accounts for the whitespace.
    expect(report.steps[0].id).toBe('minify')
    expect(report.steps[0].savedRaw).toBe(text.length - JSON.stringify(JSON.parse(text)).length)
    expect(report.before.dotLottie).toBeGreaterThan(0)
    expect(report.after.counts.keyframes).toBeLessThan(report.before.counts.keyframes)
    const saved = totalSaved(report)
    expect(saved.rawShare).toBeGreaterThan(0.5)
  })

  it('never modifies its input (frozen documents work)', async () => {
    const anim = freeze(bakedAnimation(60), true)
    const snapshot = JSON.stringify(anim)
    await optimizeAnimation(anim, 'maximum')
    expect(JSON.stringify(anim)).toBe(snapshot)
  })

  it('rejects with an AbortError when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      optimizeAnimation(bakedAnimation(60), 'balanced', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports progress for every step', async () => {
    const seen: string[] = []
    await optimizeAnimation(legacyAnimation(), 'safe', { onProgress: (step) => seen.push(step) })
    expect(seen[0]).toBe('minify')
    expect(seen[seen.length - 1]).toBe('measure')
    expect(seen).toContain('legacy')
  })
})

describe('real files', () => {
  for (const rel of REAL_FILES) {
    const missing = !exists(rel)
    for (const preset of ['safe', 'balanced', 'maximum'] as PresetId[]) {
      it.skipIf(missing)(`${rel} [${preset}]: valid, smaller, same scene`, async () => {
        const text = load(rel)
        const original = JSON.parse(text) as Animation
        const { animation, report } = await optimizeAnimation(text, preset)
        expect(report.after.raw).toBeLessThanOrEqual(report.before.raw)
        expect(report.after.gzip).toBeLessThanOrEqual(report.before.gzip)
        expect(structureProblems(animation)).toEqual([])
        const r = verifySemantic(original, animation, {
          maxFrames: 80,
          tolerance: TOLERANCE[preset],
        })
        expect(r.equivalent, describeMismatches(r.mismatches)).toBe(true)
      })
    }
  }

  it.skipIf(!exists('../../../docs/test.json'))(
    'docs/test.json saves at least 12 % raw and 12 % gzip (balanced)',
    async () => {
      const { report } = await optimizeAnimation(load('../../../docs/test.json'), 'balanced')
      const s = totalSaved(report)
      expect(s.rawShare).toBeGreaterThan(0.12)
      expect(s.gzipShare).toBeGreaterThan(0.12)
    },
  )

  it('a second pass finds (almost) nothing left and stays equivalent', async () => {
    const text = load('./fixtures/optimizer/legacy-adrock.json')
    const first = await optimizeAnimation(text, 'balanced')
    const second = await optimizeAnimation(first.json, 'balanced')
    expect(second.report.after.raw).toBeLessThanOrEqual(first.report.after.raw)
    expect(first.report.after.raw - second.report.after.raw).toBeLessThan(
      first.report.after.raw * 0.01,
    )
    const r = verifySemantic(JSON.parse(text) as Animation, second.animation, {
      maxFrames: 40,
      tolerance: { geometry: 0.15 },
    })
    expect(r.equivalent, describeMismatches(r.mismatches)).toBe(true)
  })
})

describe('analyze', () => {
  it('estimates what the pipeline does, without images', async () => {
    const baked = bakedAnimation(120)
    const a = analyze(baked, 'balanced')
    expect(a.techniques.keyframes?.changes).toBeGreaterThan(100)
    const { report } = await optimizeAnimation(baked, 'balanced')
    expect(a.estimatedRaw).toBe(report.after.raw)
    expect(a.size.raw).toBe(report.before.raw)
  })

  it('reports expressions and the legacy format', () => {
    const a = analyze(load('./fixtures/optimizer/legacy-gatin.json'))
    expect(a.version).toBe('4.0.0')
    expect(a.warnings.map((w) => w.code)).toContain('legacyFormat')
  })
})

describe('measure / recommendFormat', () => {
  it('measures raw, gzip, dotLottie and counts', () => {
    const m = measure(bakedAnimation(30))
    expect(m.raw).toBe(JSON.stringify(bakedAnimation(30)).length)
    expect(m.gzip).toBeGreaterThan(0)
    expect(m.gzip).toBeLessThan(m.raw)
    expect(m.dotLottie).toBeGreaterThan(m.gzip)
    expect(m.counts.layers).toBe(1)
    expect(m.counts.keyframes).toBe(4 * 31)
  })

  it('recommends by goal', () => {
    const anim = doc([shapeLayer([group([rect(), fill()])])])
    const size = measure(anim)
    expect(recommendFormat(anim, size, 'web').format).toBe('json')
    expect(recommendFormat(anim, size, 'mobile').format).toBe('lottie')
    // 512×512 but 30 fps: not a valid sticker.
    expect(recommendFormat(anim, size, 'telegram').reason).toBe('telegramIncompatible')
    const sticker = doc([shapeLayer([group([rect(), fill()])])], { fr: 60, op: 120 })
    expect(recommendFormat(sticker, measure(sticker), 'telegram').reason).toBe('telegram')
  })
})

describe('client (main-thread fallback)', () => {
  it('optimizes, analyzes and verifies like the pipeline', async () => {
    const client = createOptimizerClient({ worker: false })
    expect(client.usesWorker).toBe(false)
    const baked = bakedAnimation(60)
    const steps: string[] = []
    const result = await client.optimize(baked, 'balanced', (step) => steps.push(step))
    const direct = await optimizeAnimation(baked, 'balanced')
    expect(result.json).toBe(direct.json)
    expect(steps.length).toBeGreaterThan(3)
    expect((await client.analyze(baked)).techniques.keyframes).toBeDefined()
    expect(
      (
        await client.verifySemantic(baked, result.animation, {
          maxFrames: 20,
          tolerance: { geometry: 0.075 },
        })
      ).equivalent,
    ).toBe(true)
    client.dispose()
  })

  it('cancels queued and running jobs', async () => {
    const client = createOptimizerClient({ worker: false })
    const first = client.optimize(bakedAnimation(300), 'balanced')
    const second = client.optimize(bakedAnimation(60), 'balanced')
    client.cancel()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    const controller = new AbortController()
    const third = client.optimize(bakedAnimation(60), 'balanced', undefined, {
      signal: controller.signal,
    })
    controller.abort()
    await expect(third).rejects.toMatchObject({ name: 'AbortError' })
    // Still usable afterwards.
    await expect(client.optimize(bakedAnimation(10), 'safe')).resolves.toHaveProperty('json')
    client.dispose()
    await expect(client.optimize(bakedAnimation(10), 'safe')).rejects.toThrow()
  })
})

describe('autoSafe back-off plan', () => {
  it('backs off only what changed: images first, then tolerance, then lossy steps', async () => {
    const { report } = await optimizeAnimation(bakedAnimation(60), 'maximum')
    let options = resolveOptions('maximum')
    const steps: string[] = []
    for (let i = 0; i < 12; i++) {
      const next = nextBackoff(options, report)
      if (!next) break
      steps.push(
        next.step.kind === 'disable'
          ? `disable:${next.step.technique}`
          : `${next.step.kind}:${next.step.to}`,
      )
      options = next.options
    }
    // No images in the document: the image settings are never touched.
    expect(steps.some((s) => s.startsWith('imageQuality') || s === 'disable:images')).toBe(false)
    expect(steps[0]).toBe('tolerance:0.1')
    expect(steps).toContain('disable:keyframes')
    expect(steps).toContain('disable:precision')
    expect(options.techniques.keyframes).toBe(false)
  })

  it('ends with names and then the lossless techniques, so the guarantee always holds', async () => {
    const { report } = await optimizeAnimation(bakedAnimation(60), {
      preset: 'maximum',
      techniques: { keyframes: false, paths: false, precision: false, invisible: false },
    })
    // Pretend names and defaults changed something (only changed techniques are backed off).
    const changed = {
      ...report,
      steps: report.steps.map((s) =>
        s.id === 'names' || s.id === 'defaults' ? { ...s, changes: Math.max(1, s.changes) } : s,
      ),
    }
    let options = resolveOptions({
      preset: 'maximum',
      pxTolerance: 0,
      techniques: { keyframes: false, paths: false, precision: false, invisible: false },
    })
    const disabled: string[] = []
    for (let i = 0; i < 20; i++) {
      const next = nextBackoff(options, changed)
      if (!next) break
      if (next.step.kind === 'disable') disabled.push(next.step.technique!)
      options = next.options
    }
    expect(disabled.slice(0, 2)).toEqual(['names', 'defaults'])
    expect(options.techniques.names).toBe(false)
    expect(options.techniques.defaults).toBe(false)
  })

  it('samples frames evenly over the animation', () => {
    expect(visualFrames(doc([], { ip: 0, op: 60 }), 4)).toEqual([0, 19.67, 39.33, 59])
    expect(visualFrames(doc([], { ip: 10, op: 11 }), 24)).toEqual([10])
  })
})
