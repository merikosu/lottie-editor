import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import { pageTitle } from '../title'

describe('pageTitle', () => {
  it('names the open file on the pages that show it', () => {
    expect(pageTitle('edit', 'intro.json', en)).toBe('intro.json — Lottie Editor')
    expect(pageTitle('customize', 'intro.json', ru)).toBe('intro.json — Lottie Editor')
  })

  it('names the service elsewhere', () => {
    expect(pageTitle('optimize', 'intro.json', en)).toBe('Optimizer — Lottie Editor')
    expect(pageTitle('optimize', null, ru)).toBe('Оптимизатор — Lottie Editor')
    expect(pageTitle('customize', null, en)).toBe('Customize — Lottie Editor')
    expect(pageTitle('home', 'intro.json', en)).toBe('Lottie Editor')
    expect(pageTitle('edit', null, en)).toBe('Lottie Editor')
  })
})
