/**
 * Robustness: the optimizer must never fail on a damaged file (hand edits, broken exporters).
 * Real animations are damaged at random (seeded, so failures reproduce); every preset must
 * produce valid JSON that is never larger, leaving what it cannot understand as it is.
 */
import { describe, expect, it } from 'vitest'
import like from '../../samples/like.json'
import orbit from '../../samples/orbit.json'
import typing from '../../samples/typing.json'
import { optimizeAnimation } from '../optimizer/pipeline'
import type { Animation } from '../types'
import { damage, seeded } from './fixtures/optimizer/damage'

const SAMPLES: Record<string, unknown> = { like, orbit, typing }
const SEEDS = 25

describe('damaged files', () => {
  for (const [name, sample] of Object.entries(SAMPLES)) {
    it(`optimizes damaged copies of "${name}" without failing`, async () => {
      const failures: string[] = []
      for (let seed = 1; seed <= SEEDS; seed++) {
        const doc = structuredClone(sample) as Animation
        damage(doc, seeded(seed * 7919), 1 + (seed % 6))
        for (const preset of ['safe', 'maximum'] as const) {
          try {
            const { json, report } = await optimizeAnimation(structuredClone(doc), preset)
            JSON.parse(json)
            // Minify alone never grows a file; nothing else may either.
            if (report.after.raw > report.before.raw) failures.push(`${seed}/${preset}: grew`)
          } catch (err) {
            failures.push(`${seed}/${preset}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
      expect(failures).toEqual([])
    }, 60_000)
  }
})
