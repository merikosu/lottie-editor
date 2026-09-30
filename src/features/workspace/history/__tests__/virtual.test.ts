import { describe, expect, it } from 'vitest'
import { scrollToReveal, visibleRange } from '../useVirtualRows'

describe('visibleRange', () => {
  it('covers the viewport plus overscan', () => {
    expect(visibleRange(0, 280, 300, 28, 8)).toEqual({ start: 0, end: 18 })
    expect(visibleRange(280, 280, 300, 28, 8)).toEqual({ start: 2, end: 28 })
  })

  it('clamps to the list', () => {
    // Scrolled far past the content (the list shrank): the last rows stay rendered.
    expect(visibleRange(10_000, 280, 20, 28, 8)).toEqual({ start: 11, end: 20 })
    expect(visibleRange(-50, 280, 20, 28, 8)).toEqual({ start: 0, end: 18 })
    expect(visibleRange(0, 0, 5, 28, 0)).toEqual({ start: 0, end: 1 })
  })

  it('is empty for an empty list', () => {
    expect(visibleRange(0, 280, 0, 28, 8)).toEqual({ start: 0, end: 0 })
  })
})

describe('scrollToReveal', () => {
  it('returns null when the row is already visible', () => {
    expect(scrollToReveal(3, 0, 280, 28, 4)).toBeNull()
  })

  it('scrolls up to a row above the viewport (including the top padding for the first row)', () => {
    expect(scrollToReveal(0, 200, 280, 28, 4)).toBe(0)
    expect(scrollToReveal(5, 400, 280, 28, 4)).toBe(140)
  })

  it('scrolls down just enough for a row below the viewport', () => {
    // Row 20 spans 564..592 (with 4px top padding); bottom padding included.
    expect(scrollToReveal(20, 0, 280, 28, 4)).toBe(592 - 280 + 4)
  })
})
