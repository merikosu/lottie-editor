import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import type { TextData } from '@/lottie/types'
import { retype, typedText, typingTemplate } from '../lib/typing'

const doc = (t: string) => ({ t, s: 24, f: 'Inter', fc: [1, 1, 1] })

function typing(states: string[], times?: number[]): TextData {
  return { d: { k: states.map((t, i) => ({ s: doc(t), t: times?.[i] ?? i * 10 })) } }
}

describe('typedText', () => {
  it('recognizes texts typed letter by letter', () => {
    expect(typedText(typing(['H', 'He', 'Hel', 'Hell', 'Hello']))).toBe('Hello')
    expect(typedText(typing(['', 'Hi', 'Hi th', 'Hi there']))).toBe('Hi there')
    expect(typedText(typing(['A\r', 'A\rB', 'A\rBC']))).toBe('A\nBC')
  })

  it('rejects other keyframed texts', () => {
    expect(typedText(typing(['Hello']))).toBeNull()
    expect(typedText(typing(['', 'Hello']))).toBeNull()
    expect(typedText(typing(['Sale', 'Sale!', 'Buy']))).toBeNull()
    expect(typedText(typing(['He', 'He', 'Hello']))).toBeNull()
    expect(typedText(undefined)).toBeNull()
  })
})

/** Retypes `text` with its own template. */
function retyped(text: TextData, content: string): TextData {
  const template = typingTemplate(text)!
  return produce(text, (d) => {
    retype(d, content, template)
  })
}

describe('retype', () => {
  it('types the new text letter by letter over the same span', () => {
    const next = retyped(
      typing(['H', 'He', 'Hel', 'Hell', 'Hello'], [0, 10, 20, 30, 40]),
      'Hi there',
    )
    expect(next.d.k.map((k) => k.s.t)).toEqual([
      'H',
      'Hi',
      'Hi ',
      'Hi t',
      'Hi th',
      'Hi the',
      'Hi ther',
      'Hi there',
    ])
    const times = next.d.k.map((k) => k.t)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBe(40)
    expect(typedText(next)).toBe('Hi there')
  })

  it('keeps an empty first state and the letters per step', () => {
    const next = retyped(typing(['', 'Ab', 'Abcd', 'Abcdef'], [5, 15, 25, 35]), 'Wxyz')
    expect(next.d.k.map((k) => k.s.t)).toEqual(['', 'Wx', 'Wxyz'])
    expect(next.d.k.map((k) => k.t)).toEqual([5, 20, 35])
  })

  it('stores line breaks the way players expect and copies the style per state', () => {
    const next = retyped(typing(['H', 'Hi', 'Hi!']), 'A\nB')
    expect(next.d.k.map((k) => k.s.t)).toEqual(['A', 'A\r', 'A\rB'])
    expect(next.d.k[0].s.fc).not.toBe(next.d.k[1].s.fc)
    expect(next.d.k[2].s).toMatchObject({ s: 24, f: 'Inter', fc: [1, 1, 1] })
  })

  it('keeps typing through short drafts with the template of the original', () => {
    const original = typing(['H', 'He', 'Hel', 'Hell', 'Hello'], [0, 10, 20, 30, 40])
    const template = typingTemplate(original)!
    // Select all, type "Hi there" letter by letter: every draft is written from the template.
    let text = original
    for (const draft of ['H', 'Hi', 'Hi ', 'Hi there']) {
      text = produce(text, (d) => {
        retype(d, draft, template)
      })
    }
    expect(typedText(text)).toBe('Hi there')
    expect(text.d.k[text.d.k.length - 1].t).toBe(40)
  })

  it('has no template for other texts', () => {
    expect(typingTemplate(typing(['Sale', 'Buy', 'Now']))).toBeNull()
    expect(typingTemplate(typing(['Hello']))).toBeNull()
  })
})
