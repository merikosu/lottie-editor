/**
 * The Issues panel renders every issue of damaged files: titles, descriptions, locations and
 * targets must never throw, whatever the document contains.
 */
import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import { mutate, rng } from '@/lottie/__tests__/insights.fixtures'
import type { Animation } from '@/lottie/types'
import { issuesForTarget, validate } from '@/lottie/validate'
import testJsonText from '../../../../docs/test.json?raw'
import walletText from '../../../../docs/wallet_flag.json?raw'
import {
  describeIssue,
  issueAbout,
  issueTitle,
  locate,
  placesSummary,
  playerChips,
  showTarget,
  type FormatOptions,
} from '../format'
import { buildRows } from '../rows'

const OPTIONS: FormatOptions[] = [
  { t: en, lang: 'en' },
  { t: ru, lang: 'ru' },
]

describe('issue texts on damaged files', () => {
  for (const [name, text] of Object.entries({
    'test.json': testJsonText,
    'wallet_flag.json': walletText,
  })) {
    it(`renders every issue of mutated ${name}`, { timeout: 30_000 }, () => {
      const base = JSON.parse(text) as Animation
      const random = rng(name.length * 31337)
      for (let round = 0; round < 40; round++) {
        const doc = mutate(base, random, 1 + Math.floor(random() * 10))
        const issues = issuesForTarget(validate(doc), 'all')
        const expanded = Object.fromEntries(issues.map((i) => [i.id, true]))
        expect(() => buildRows(issues, expanded, {})).not.toThrow()
        for (const o of OPTIONS) {
          for (const issue of issues) {
            const where = `${name} round ${round}: ${issue.code}`
            expect(() => {
              const title = issueTitle(issue, o, doc)
              expect(title).not.toMatch(/undefined|\[object/)
              issueAbout(issue, o, doc)
              placesSummary(issue, doc, o.t)
              playerChips(issue.platforms, o.t)
              describeIssue(issue, o, doc)
              for (const path of issue.paths.slice(0, 20)) {
                locate(doc, path, o.t)
                showTarget(doc, path)
              }
            }, where).not.toThrow()
          }
        }
      }
    })
  }
})
