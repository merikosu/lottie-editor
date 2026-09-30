/**
 * Fuzzy matching for the command palette and the shortcuts sheet.
 *
 * A query token matches a text when its characters appear in order. Among all alignments the
 * best one is chosen with a small dynamic program that rewards what people type on purpose:
 * word starts ("tt" → Toggle Timeline), runs of consecutive characters ("time" → Timeline) and
 * a match at the very start. Jumps into the middle of a word are allowed but expensive, so
 * scattered letters rank far below real matches and are dropped when they are the only link.
 *
 * Matching is case-insensitive and treats "ё" as "е" (Russian users rarely type the dots).
 * Match positions index into the original text so the UI can highlight them.
 */

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query token. */
  score: number
  /** Indices of the matched characters in the original text, ascending. */
  positions: number[]
}

const MATCH = 1
const WORD_START = 2
const FIRST_CHAR = 1
const CONSECUTIVE = 2.5
/** Per skipped character between two matched characters. */
const GAP = 0.08
/** Per character before the first match. */
const LEAD = 0.03
/** A non-consecutive match that lands inside a word ("tgl" → "ToGgLe"). */
const MID_WORD_JUMP = 2.5
/** The first character matches inside a word ("oom" → "zOOM"). */
const MID_WORD_START = 1.5
/** Whole text equals the token. */
const EXACT = 4
/** Text starts with the token. */
const PREFIX = 1.5
/** Longer texts are cut before matching (keeps the worst case cheap). */
const MAX_TEXT = 256

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
const UPPER = /\p{Lu}/u
const LOWER = /\p{Ll}/u
const DIGIT = /\p{N}/u

/** Lower-cases one UTF-16 unit, keeping the length (so positions stay valid); ё → е. */
export function foldChar(ch: string): string {
  const lower = ch.toLowerCase()
  if (lower.length !== 1) return ch
  return lower === 'ё' ? 'е' : lower
}

/** Case- and ё-folded copy of `text` with the same length as the input. */
export function fold(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) out += foldChar(text[i])
  return out
}

/**
 * Word starts: the first character, a letter or digit after a separator, a camelCase hump
 * and a letter/digit boundary ("mp4" → m, 4).
 */
export function wordStarts(text: string): boolean[] {
  const starts: boolean[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (i === 0) {
      starts.push(true)
      continue
    }
    const prev = text[i - 1]
    const word = LETTER_OR_DIGIT.test(ch)
    const prevWord = LETTER_OR_DIGIT.test(prev)
    starts.push(
      (word && !prevWord) ||
        (UPPER.test(ch) && LOWER.test(prev)) ||
        (word && prevWord && DIGIT.test(ch) !== DIGIT.test(prev)),
    )
  }
  return starts
}

/** True when every character of `token` occurs in `text` in order (cheap pre-check). */
function isSubsequence(token: string, text: string): boolean {
  let j = 0
  for (let i = 0; i < text.length && j < token.length; i++) if (text[i] === token[j]) j++
  return j === token.length
}

/**
 * Best alignment of one query token in a text. `token` must already be folded (see `fold`).
 * Returns null when the token does not match.
 */
export function fuzzyMatchToken(token: string, text: string): FuzzyMatch | null {
  const m = token.length
  if (m === 0) return { score: 0, positions: [] }
  const original = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
  const hay = fold(original)
  const n = hay.length
  if (m > n || !isSubsequence(token, hay)) return null

  const starts = wordStarts(original)
  // A single character only matches a word start: "a" should find "Add marker", not "Play".
  if (m === 1) {
    for (let i = 0; i < n; i++) {
      if (hay[i] === token && starts[i]) {
        const score =
          MATCH + WORD_START + (i === 0 ? FIRST_CHAR : 0) - LEAD * i + (n === 1 ? EXACT : 0)
        return { score, positions: [i] }
      }
    }
    return null
  }

  const NEG = -Infinity
  const charScore = (i: number) => MATCH + (starts[i] ? WORD_START : 0) + (i === 0 ? FIRST_CHAR : 0)
  // dp[j * n + i]: best score with token[j] matched at hay[i]; from[]: index of token[j - 1].
  const dp = new Float64Array(m * n).fill(NEG)
  const from = new Int32Array(m * n).fill(-1)

  for (let i = 0; i < n; i++) {
    if (hay[i] !== token[0]) continue
    dp[i] = charScore(i) - LEAD * i - (starts[i] ? 0 : MID_WORD_START)
  }

  for (let j = 1; j < m; j++) {
    const row = j * n
    const prevRow = row - n
    // Running best of dp[j-1][k] + GAP * k over k <= i - 2 (non-consecutive predecessors).
    let bestJump = NEG
    let bestJumpAt = -1
    for (let i = j; i < n; i++) {
      const k = i - 2
      if (k >= 0 && dp[prevRow + k] !== NEG) {
        const v = dp[prevRow + k] + GAP * k
        if (v > bestJump) {
          bestJump = v
          bestJumpAt = k
        }
      }
      if (hay[i] !== token[j]) continue
      const base = charScore(i)
      let best = NEG
      let bestFrom = -1
      const consecutive = dp[prevRow + i - 1]
      if (consecutive !== NEG) {
        best = consecutive + base + CONSECUTIVE
        bestFrom = i - 1
      }
      if (bestJump !== NEG) {
        const jump = bestJump - GAP * (i - 1) + base - (starts[i] ? 0 : MID_WORD_JUMP)
        if (jump > best) {
          best = jump
          bestFrom = bestJumpAt
        }
      }
      dp[row + i] = best
      from[row + i] = bestFrom
    }
  }

  const last = (m - 1) * n
  let end = -1
  let score = NEG
  for (let i = m - 1; i < n; i++) {
    if (dp[last + i] > score) {
      score = dp[last + i]
      end = i
    }
  }
  if (end < 0 || score === NEG) return null

  const positions = Array.from({ length: m }, () => 0)
  for (let j = m - 1, i = end; j >= 0; j--) {
    positions[j] = i
    i = from[j * n + i]
  }

  // Too scattered to be intentional: most characters landed inside words after jumps.
  if (score < m * 0.9) return null

  // "Open…" is exactly "open": trailing dots of menu titles are not part of the name.
  if (hay === token || hay.replace(/(…|\.\.\.)$/u, '') === token) score += EXACT
  else if (hay.startsWith(token)) score += PREFIX
  return { score, positions }
}

/** Splits a query into folded, whitespace-separated tokens. */
export function queryTokens(query: string): string[] {
  return fold(query.trim())
    .split(/\s+/)
    .filter((s) => s.length > 0)
}
