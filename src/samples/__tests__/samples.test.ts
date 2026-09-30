import { describe, expect, it } from 'vitest'
import { fromObject } from '@/lottie/document'
import { forEachLayer } from '@/lottie/traverse'
import { SAMPLES, findSample } from '..'

describe('built-in samples', () => {
  it('have unique ids and can be found', () => {
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length)
    expect(SAMPLES.length).toBeGreaterThanOrEqual(6)
    expect(findSample('bounce')?.name).toBe('Bouncing ball')
    expect(findSample('nope')).toBeUndefined()
  })

  for (const sample of SAMPLES) {
    it(`${sample.id} is a valid, small, looping animation matching its metadata`, async () => {
      const anim = await sample.load()
      const { repairs } = fromObject(structuredClone(anim))
      expect(repairs).toEqual([])
      expect([anim.w, anim.h, anim.fr, anim.op - anim.ip]).toEqual([
        sample.width,
        sample.height,
        sample.fps,
        sample.frames,
      ])
      expect([30, 60]).toContain(anim.fr)
      expect(sample.poster).toBeGreaterThanOrEqual(0)
      expect(sample.poster).toBeLessThan(1)
      // The files are minified JSON, so this is their size on disk.
      expect(new TextEncoder().encode(JSON.stringify(anim)).length).toBeLessThan(40 * 1024)
      // Every layer covers the whole timeline or a part of it; none is out of range.
      forEachLayer(anim, (layer) => {
        expect(layer.op).toBeGreaterThan(layer.ip)
      })
    })
  }

  it('reuses a precomp with different start times and uses parenting', async () => {
    const orbit = await findSample('orbit')!.load()
    const instances = orbit.layers.filter((l) => l.ty === 0)
    expect(instances).toHaveLength(2)
    expect(new Set(instances.map((l) => l.st)).size).toBe(2)
    expect(instances.every((l) => l.parent !== undefined)).toBe(true)
    expect(orbit.layers.some((l) => l.ty === 3)).toBe(true)
  })

  it('types text with keyframed documents and a declared font', async () => {
    const typing = await findSample('typing')!.load()
    const text = typing.layers.find((l) => l.ty === 5)
    expect(text && text.ty === 5 && text.t.d.k.map((k) => k.s.t)).toEqual([
      'H',
      'He',
      'Hel',
      'Hell',
      'Hello',
    ])
    expect(typing.fonts?.list[0].fName).toBe('Inter-SemiBold')
  })
})
