/**
 * Robustness: the checker, statistics and fixes must never throw, whatever a damaged file
 * contains. Real files are mutated at random (seeded, so failures reproduce) and every
 * insights entry point runs on the result.
 */
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { detectFeatures } from '../compat'
import { computeStats, measureDocument } from '../stats'
import type { Animation } from '../types'
import { applyFixes, issuesForTarget, playerLevels, validate } from '../validate'
import { mutate, rng } from './insights.fixtures'
import testJsonText from '../../../docs/test.json?raw'
import walletText from '../../../docs/wallet_flag.json?raw'
import bounceText from '../../samples/bounce.json?raw'
import typingText from '../../samples/typing.json?raw'

const FILES: Record<string, string> = {
  'test.json': testJsonText,
  'wallet_flag.json': walletText,
  bounce: bounceText,
  typing: typingText,
}

describe('insights on damaged files', () => {
  for (const [name, text] of Object.entries(FILES)) {
    it(`never throws on mutations of ${name}`, { timeout: 30_000 }, () => {
      const base = JSON.parse(text) as Animation
      const random = rng(name.length * 7919)
      for (let round = 0; round < 60; round++) {
        const doc = mutate(base, random, 1 + Math.floor(random() * 12))
        const where = `${name} round ${round}`
        let issues: ReturnType<typeof validate> = []
        expect(
          () => (issues = validate(doc, { rawBytes: 1000, gzipBytes: 100 })),
          where,
        ).not.toThrow()
        expect(() => computeStats(doc), where).not.toThrow()
        expect(() => measureDocument(doc, { gzip: false }), where).not.toThrow()
        expect(() => detectFeatures(doc), where).not.toThrow()
        for (const target of ['all', 'telegram'] as const) {
          expect(() => playerLevels(issuesForTarget(issues, target), target), where).not.toThrow()
        }
        // Every fix (safe or not) applied together, then checked again.
        let fixed: Animation = doc
        expect(() => {
          fixed = produce(doc, (draft) => {
            applyFixes(draft as Animation, issues)
          })
        }, where).not.toThrow()
        expect(() => validate(fixed), where).not.toThrow()
      }
    })
  }
})
