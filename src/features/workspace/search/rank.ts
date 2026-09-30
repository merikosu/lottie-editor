/**
 * Multi-field ranking on top of the fuzzy matcher.
 *
 * Every query token must match at least one field of an item (tokens may match different
 * fields: "export gif" = title "Export…" + keyword "gif"). A token scores its best field,
 * weighted by the field's importance. Highlight positions are only collected for the first
 * field, which is the text the UI shows.
 */
import { fold, fuzzyMatchToken, queryTokens } from './fuzzy'
import { switchLayout } from './keyboard-layout'

export interface SearchField {
  text: string
  /** Relative importance: 1 for the visible title, lower for synonyms and categories. */
  weight: number
  /**
   * Match only a query word equal to the whole text (e.g. a layer kind: "text" lists text
   * layers, but "sha" must not list every shape layer).
   */
  exact?: boolean
  /** Weight when a query word equals the whole text (default EXACT_SYNONYM_WEIGHT). */
  exactWeight?: number
}

export interface ItemMatch {
  score: number
  /** Matched character indices in the first field (the displayed text). */
  positions: number[]
}

export interface PreparedQuery {
  raw: string
  tokens: string[]
  /** The whole query, folded, for the phrase bonus. */
  phrase: string
  /** The same query as typed in the other keyboard layout, if different. */
  alternate: PreparedQuery | null
}

/** Score of an `exact` field match (before its weight), like a strong whole-word match. */
const EXACT_FIELD = 12
/**
 * A word typed exactly as a synonym ("fit" for Zoom to fit, "save" for Download) states intent
 * more clearly than a title that merely starts with it, whatever the word's length; only the
 * exact title ranks higher.
 */
export const EXACT_SYNONYM_WEIGHT = 0.95

/** A query typed in the wrong layout ranks a little below the same words typed correctly. */
const ALTERNATE_FACTOR = 0.92
/** The visible text contains the whole query as typed (spaces included). */
const PHRASE = 3
const PHRASE_PREFIX = 2
/**
 * Every word of a multi-word query is in the visible text, in any order ("export gif" →
 * "Export as GIF…"): what the user reads is what they typed, which beats a keyword match.
 */
const TITLE_ALL = 10

function prepareOne(raw: string): PreparedQuery | null {
  const tokens = queryTokens(raw)
  if (!tokens.length) return null
  return { raw, tokens, phrase: tokens.join(' '), alternate: null }
}

/** Parses a query once for many items. Returns null for an empty query. */
export function prepareQuery(query: string): PreparedQuery | null {
  const main = prepareOne(query)
  if (!main) return null
  const switched = switchLayout(query.trim())
  const alternate = switched ? prepareOne(switched) : null
  return { ...main, alternate: alternate && alternate.phrase !== main.phrase ? alternate : null }
}

function matchTokens(query: PreparedQuery, fields: readonly SearchField[]): ItemMatch | null {
  let total = 0
  const positions = new Set<number>()
  let allInTitle = true
  for (const token of query.tokens) {
    let best = 0
    let matched = false
    let inTitle = false
    for (let f = 0; f < fields.length; f++) {
      const field = fields[f]
      if (!field.text) continue
      if (field.exact) {
        if (fold(field.text) === token && (!matched || EXACT_FIELD * field.weight > best)) {
          best = EXACT_FIELD * field.weight
          matched = true
        }
        continue
      }
      const match = fuzzyMatchToken(token, field.text)
      if (!match) continue
      if (f === 0) inTitle = true
      const weight =
        f > 0 && fold(field.text) === token
          ? Math.max(field.weight, field.exactWeight ?? EXACT_SYNONYM_WEIGHT)
          : field.weight
      const score = match.score * weight
      if (!matched || score > best) {
        best = score
        matched = true
      }
      // The visible text is highlighted even when a synonym scored higher for this token.
      if (f === 0) for (const p of match.positions) positions.add(p)
    }
    if (!matched) return null
    total += best
    allInTitle &&= inTitle
  }
  const title = fields[0]?.text ? fold(fields[0].text) : ''
  if (query.tokens.length > 1 && title) {
    if (title.startsWith(query.phrase)) total += PHRASE + PHRASE_PREFIX
    else if (title.includes(query.phrase)) total += PHRASE
    if (allInTitle) total += TITLE_ALL
  }
  return { score: total, positions: [...positions].sort((a, b) => a - b) }
}

/** Scores one item. Returns null when some token matches none of its fields. */
export function matchItem(query: PreparedQuery, fields: readonly SearchField[]): ItemMatch | null {
  const direct = matchTokens(query, fields)
  const switched = query.alternate ? matchTokens(query.alternate, fields) : null
  if (switched && (!direct || switched.score * ALTERNATE_FACTOR > direct.score)) {
    return { score: switched.score * ALTERNATE_FACTOR, positions: switched.positions }
  }
  return direct
}

export interface Ranked<T> extends ItemMatch {
  item: T
}

/**
 * Ranks items by score (best first). Ties keep the shorter visible text first, then the
 * original order, so results never jump around between keystrokes.
 */
export function rankItems<T>(
  items: readonly T[],
  fieldsOf: (item: T) => readonly SearchField[],
  query: PreparedQuery,
  boost?: (item: T) => number,
): Ranked<T>[] {
  const out: (Ranked<T> & { order: number; length: number })[] = []
  items.forEach((item, order) => {
    const fields = fieldsOf(item)
    const match = matchItem(query, fields)
    if (!match) return
    out.push({
      item,
      score: match.score + (boost ? boost(item) : 0),
      positions: match.positions,
      order,
      length: fields[0]?.text.length ?? 0,
    })
  })
  out.sort((a, b) => b.score - a.score || a.length - b.length || a.order - b.order)
  return out.map(({ item, score, positions }) => ({ item, score, positions }))
}
