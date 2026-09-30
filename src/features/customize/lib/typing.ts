/**
 * Typewriter texts: a keyframed source text whose states are growing prefixes of the last one
 * ("H", "He", "Hel", "Hell", "Hello"). Customizing such a text means editing its final words;
 * the letter-by-letter states are then rebuilt over the same span of time.
 */
import { textFromEditor, textKeyframes, textToEditor } from '@/lottie/text'
import type { TextData, TextDocument } from '@/lottie/types'

/** How a typewriter text types: kept while it is edited (short drafts must not lose it). */
export interface TypingTemplate {
  /** Times of the first and last state. */
  start: number
  end: number
  /** Letters added per state. */
  perStep: number
  /** The first state is empty (the text appears letter by letter from nothing). */
  fromEmpty: boolean
  /** Style of the first state (JSON), given to every state. */
  style: string
}

/**
 * The final text (editor form, "\n" line breaks) when the text types itself: at least three
 * states, each a prefix of the last, growing every time. Null otherwise.
 */
export function typedText(text: TextData | null | undefined): string | null {
  const kfs = textKeyframes(text)
  if (kfs.length < 3) return null
  const states = kfs.map((k) => textToEditor(k.s.t))
  const last = states[states.length - 1]
  for (let i = 0; i < states.length; i++) {
    if (!last.startsWith(states[i])) return null
    if (i > 0 && states[i].length <= states[i - 1].length) return null
  }
  return last
}

/** The template of a typewriter text, or null when the text does not type itself. */
export function typingTemplate(text: TextData | null | undefined): TypingTemplate | null {
  const final = typedText(text)
  if (final === null) return null
  const kfs = textKeyframes(text)
  const first = textToEditor(kfs[0].s.t)
  return {
    start: kfs[0].t,
    end: kfs[kfs.length - 1].t,
    perStep: Math.max(1, Math.round((final.length - first.length) / (kfs.length - 1))),
    fromEmpty: first.length === 0,
    style: JSON.stringify(kfs[0].s),
  }
}

/**
 * Makes `text` type `content` (editor form) the way `template` describes: same start and end
 * times, same letters per state, the template's style for every state. Mutates `text` (use
 * inside `updateDoc`).
 */
export function retype(text: TextData, content: string, template: TypingTemplate): void {
  const { perStep } = template
  const lengths: number[] = []
  const first = template.fromEmpty ? 0 : Math.min(content.length, perStep)
  for (let n = first; n < content.length; n += perStep) lengths.push(n)
  lengths.push(content.length)
  const span = lengths.length > 1 ? (template.end - template.start) / (lengths.length - 1) : 0
  // A JSON copy per state: states must not share arrays (colors, boxes) with each other.
  text.d.k = lengths.map((n, i) => ({
    s: { ...(JSON.parse(template.style) as TextDocument), t: textFromEditor(content.slice(0, n)) },
    t: Math.round((template.start + span * i) * 1000) / 1000,
  }))
}
