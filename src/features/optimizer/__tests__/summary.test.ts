/**
 * What the queue derives from its jobs: which results are current, statuses through the whole
 * life of a job (reading → optimizing → checking → done, relaxing on a difference), sizes, totals
 * and output formats.
 */
import { describe, expect, it } from 'vitest'
import { resolveOptions } from '@/lottie/optimizer'
import {
  isCurrent,
  isVerified,
  jobMatch,
  jobSizes,
  jobStatus,
  jobWorstShare,
  optionsKey,
  outputFormat,
  policyFor,
  queueTotals,
  relaxation,
  sameFormat,
  savedShare,
  type Policy,
} from '../model/summary'
import type { OptimizerSettings } from '../model/settings'
import { BOUNCE, LIKE, balanced, donePart, job, part, result, visual } from './fixtures'

const settings = (patch: Partial<OptimizerSettings> = {}) => ({
  options: balanced(),
  guarantee: true,
  verifyFrames: 'sampled' as const,
  ...patch,
})

describe('policy', () => {
  it('follows the queue unless the file has its own options', () => {
    const queue = settings()
    const own = resolveOptions('maximum')
    expect(policyFor(job(), queue).key).toBe(optionsKey(queue.options))
    expect(policyFor(job({ options: own }), queue).key).toBe(optionsKey(own))
    expect(policyFor(job(), queue).guarantee).toBe(true)
  })

  it('keys differ for different options and match for equal ones', () => {
    expect(optionsKey(resolveOptions('safe'))).not.toBe(optionsKey(resolveOptions('balanced')))
    expect(optionsKey(resolveOptions('safe'))).toBe(optionsKey(resolveOptions('safe')))
  })
})

describe('isCurrent / isVerified', () => {
  it('needs a result made with the policy options', async () => {
    const p = await donePart()
    const policy = policyFor(job(), settings())
    expect(isCurrent(p, policy)).toBe(true)
    expect(isCurrent({ ...p, result: null }, policy)).toBe(false)
    expect(isCurrent(p, policyFor(job(), settings({ options: resolveOptions('safe') })))).toBe(
      false,
    )
  })

  it('counts relaxed results as current only while the guarantee is on', async () => {
    const p = await donePart()
    const relaxed = {
      ...p,
      result: { ...p.result!, backoffs: [{ kind: 'tolerance' as const, from: 0.05, to: 0.025 }] },
    }
    expect(isCurrent(relaxed, policyFor(job(), settings()))).toBe(true)
    expect(isCurrent(relaxed, policyFor(job(), settings({ guarantee: false })))).toBe(false)
  })

  it('a check belongs to one result and one frames setting', async () => {
    const p = await donePart()
    const policy = policyFor(job(), settings())
    expect(isVerified(p, policy)).toBe(true)
    expect(isVerified({ ...p, verify: { ...p.verify, of: 'other json' } }, policy)).toBe(false)
    expect(isVerified(p, policyFor(job(), settings({ verifyFrames: 'all' })))).toBe(false)
    expect(
      isVerified(
        { ...p, verify: { status: 'running', of: p.result!.json, frames: 'sampled' } },
        policy,
      ),
    ).toBe(false)
    // A check that could not run is over too (the file is "not checked", not stuck).
    expect(
      isVerified(
        { ...p, verify: { status: 'error', of: p.result!.json, frames: 'sampled' } },
        policy,
      ),
    ).toBe(true)
  })
})

describe('jobStatus', () => {
  const policy: Policy = policyFor(job(), settings())

  it('walks through the life of a job', async () => {
    expect(jobStatus(job({ phase: 'reading' }), policy)).toBe('reading')
    expect(jobStatus(job({ phase: 'error' }), policy)).toBe('error')
    expect(jobStatus(job({ parts: [part()] }), policy)).toBe('queued')
    const running = {
      ...part(),
      run: { key: policy.key, progress: 0.5, step: 'precision' as const },
    }
    expect(jobStatus(job({ parts: [running] }), policy)).toBe('optimizing')
    const done = await donePart()
    expect(jobStatus(job({ parts: [{ ...done, verify: { status: 'pending' } }] }), policy)).toBe(
      'verifying',
    )
    expect(jobStatus(job({ parts: [done] }), policy)).toBe('done')
  })

  it('is failed when a part failed for the current settings only', () => {
    const failed = { ...part(), error: { title: 'x', lines: [], key: policy.key } }
    expect(jobStatus(job({ parts: [failed] }), policy)).toBe('error')
    const stale = { ...part(), error: { title: 'x', lines: [], key: 'old settings' } }
    expect(jobStatus(job({ parts: [stale] }), policy)).toBe('queued')
  })

  it('waits for the slowest part of a file with several animations', async () => {
    const done = await donePart()
    expect(jobStatus(job({ parts: [done, part(LIKE, 'like')] }), policy)).toBe('queued')
  })

  it('queues a safer run when the check found a difference (guarantee on)', async () => {
    const different = await donePart(BOUNCE, balanced(), false)
    const next = relaxation(different, policy)
    expect(next).not.toBeNull()
    expect(next!.backoffs).toHaveLength(1)
    expect(jobStatus(job({ parts: [different] }), policy)).toBe('queued')
    // Without the guarantee the result stays as it is and asks for review.
    const off = policyFor(job(), settings({ guarantee: false }))
    expect(relaxation(different, off)).toBeNull()
    expect(jobStatus(job({ parts: [different] }), off)).toBe('done')
    expect(jobMatch(job({ parts: [different] }), off)).toBe('different')
  })

  it('relaxes step by step and stops when nothing is left to relax', async () => {
    const safe = resolveOptions('safe')
    const policySafe = policyFor(job(), settings({ options: safe }))
    let p = await donePart(BOUNCE, safe, false)
    const steps: string[] = []
    for (let i = 0; i < 20; i++) {
      const next = relaxation(p, policySafe)
      if (!next) break
      steps.push(next.backoffs.map((b) => b.technique).join(','))
      // The relaxed run: its result keeps the requested key and still differs.
      const r = await result(BOUNCE, next.effective)
      p = {
        ...p,
        result: { ...r, key: policySafe.key, backoffs: next.backoffs },
        verify: { status: 'done', of: r.json, frames: 'sampled', visual: visual(false) },
      }
    }
    // Each round turns one more technique off (the ones that changed something).
    expect(steps.length).toBeGreaterThan(0)
    expect(steps[steps.length - 1].split(',')).toHaveLength(steps.length)
    expect(relaxation(p, policySafe)).toBeNull()
    expect(jobStatus(job({ parts: [p] }), policySafe)).toBe('done')
    expect(jobMatch(job({ parts: [p] }), policySafe)).toBe('different')
  })
})

describe('sizes and totals', () => {
  it('adds up the parts of a job', async () => {
    const a = await donePart(BOUNCE)
    const b = await donePart(LIKE)
    const sizes = jobSizes(job({ parts: [a, b] }))!
    expect(sizes.beforeRaw).toBe(a.result!.report.before.raw + b.result!.report.before.raw)
    expect(sizes.afterGzip).toBe(a.result!.report.after.gzip + b.result!.report.after.gzip)
    expect(jobSizes(job({ parts: [a, part(LIKE)] }))).toBeNull()
  })

  it('computes shares safely', () => {
    expect(savedShare(200, 150)).toBe(0.25)
    expect(savedShare(0, 0)).toBe(0)
    expect(savedShare(100, 120)).toBeCloseTo(-0.2)
  })

  it('counts files by state over the queue', async () => {
    const identical = job({ parts: [await donePart(BOUNCE)] })
    const different = job({ parts: [await donePart(LIKE, balanced(), false)] })
    const failed = job({ phase: 'error', error: { title: 'x', lines: [] } })
    const reading = job({ phase: 'reading' })
    const totals = queueTotals(
      [identical, different, failed, reading],
      settings({ guarantee: false }),
    )
    expect(totals.files).toBe(4)
    expect(totals.measured).toBe(2)
    expect(totals.failed).toBe(1)
    expect(totals.busy).toBe(1)
    expect(totals.identical).toBe(1)
    expect(totals.different).toBe(1)
    expect(totals.sizes.beforeRaw).toBe(
      identical.parts[0].result!.report.before.raw + different.parts[0].result!.report.before.raw,
    )
    expect(jobWorstShare(different)).toBeCloseTo(0.05)
  })

  it('a check that could not run makes the file "not checked"', async () => {
    const p = await donePart()
    const unverified = {
      ...p,
      verify: { status: 'error' as const, of: p.result!.json, frames: 'sampled' as const },
    }
    expect(jobMatch(job({ parts: [unverified] }), policyFor(job(), settings()))).toBe('unverified')
  })
})

describe('output formats', () => {
  it('keeps the input format for "same as input"', () => {
    expect(sameFormat('json')).toBe('json')
    expect(sameFormat('zip')).toBe('json')
    expect(sameFormat('lottie')).toBe('lottie')
    expect(sameFormat('tgs')).toBe('tgs')
  })

  it('follows the queue choice, except that several animations need a .lottie', () => {
    const one = job({ input: 'tgs', parts: [part()] })
    expect(outputFormat(one, 'same')).toBe('tgs')
    expect(outputFormat(one, 'json')).toBe('json')
    expect(outputFormat(one, 'lottie')).toBe('lottie')
    const several = job({ input: 'json', parts: [part(), part(LIKE, 'like')] })
    expect(outputFormat(several, 'json')).toBe('lottie')
    expect(outputFormat(several, 'same')).toBe('lottie')
  })
})

describe('fixtures', () => {
  it('produce real, smaller results', async () => {
    const r = await result(BOUNCE)
    expect(r.report.after.raw).toBeLessThan(r.report.before.raw)
    expect(visual(true).match).toBe(true)
  })
})
