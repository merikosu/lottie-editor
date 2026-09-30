/**
 * Hand-written JSON scanning for the code view:
 *  - `findJsonError`: strict validation that reports WHERE and WHY the text is not JSON, with
 *    stable codes the UI translates (browsers' JSON.parse messages differ and Safari's carry
 *    no position at all).
 *  - `findPathRange`: locates a JSON path (e.g. ['layers', 3, 'ks']) by skipping values
 *    without building a tree. Used when CodeMirror's incremental syntax tree does not reach
 *    the target: on a 16 MB document it takes ~40 ms, a full Lezer parse ~3 s (measured).
 */
import type { NodePath } from '@/lottie/path'

export type JsonErrorCode =
  | 'empty'
  | 'unexpected-end'
  | 'unexpected-token'
  | 'expected-property'
  | 'trailing-comma'
  | 'expected-colon'
  | 'expected-comma-object'
  | 'expected-comma-array'
  | 'unterminated-string'
  | 'bad-escape'
  | 'control-character'
  | 'bad-number'
  | 'bad-literal'
  | 'trailing-content'
  | 'comment'

export interface JsonSyntaxError {
  code: JsonErrorCode
  /** Offset of the problem in the text. */
  pos: number
  /** End of the offending token (for highlighting); defaults to pos + 1. */
  end?: number
  /** The offending text, when useful in a message (a character, word or number). */
  found?: string
}

const OBJ = 1
const ARR = 2

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const WORD = /[A-Za-z_$][\w$]*/y
const TOKEN_END = /[^\s,:[\]{}"]*/y
const STRING_SPECIAL = /["\\\u0000-\u001f]/g // oxlint-disable-line no-control-regex -- control chars are invalid in strings

function isWs(c: number): boolean {
  return c === 32 || c === 10 || c === 13 || c === 9
}

function skipWs(text: string, i: number): number {
  while (i < text.length && isWs(text.charCodeAt(i))) i++
  return i
}

function isDelimiter(c: number): boolean {
  return Number.isNaN(c) || isWs(c) || c === 44 || c === 93 || c === 125 || c === 58
}

function tokenEnd(text: string, i: number): number {
  TOKEN_END.lastIndex = i
  TOKEN_END.exec(text)
  return Math.max(i + 1, TOKEN_END.lastIndex)
}

/** Scans a string starting at the opening quote; returns the index after the closing quote. */
function scanString(text: string, start: number): { end: number } | { error: JsonSyntaxError } {
  let i = start + 1
  for (;;) {
    STRING_SPECIAL.lastIndex = i
    const m = STRING_SPECIAL.exec(text)
    if (!m) return { error: { code: 'unterminated-string', pos: start, end: text.length } }
    const at = m.index
    const c = text.charCodeAt(at)
    if (c === 34) return { end: at + 1 }
    if (c === 92) {
      const next = text[at + 1]
      if (next === undefined)
        return { error: { code: 'unterminated-string', pos: start, end: text.length } }
      if (next === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6))) {
          return {
            error: {
              code: 'bad-escape',
              pos: at,
              end: Math.min(text.length, at + 6),
              found: text.slice(at, at + 6),
            },
          }
        }
        i = at + 6
      } else if ('"\\/bfnrt'.includes(next)) {
        i = at + 2
      } else {
        return { error: { code: 'bad-escape', pos: at, end: at + 2, found: `\\${next}` } }
      }
      continue
    }
    // Raw control character (most often a line break inside a string).
    if (c === 10 || c === 13) return { error: { code: 'unterminated-string', pos: start, end: at } }
    return { error: { code: 'control-character', pos: at } }
  }
}

function isCommentStart(text: string, i: number): boolean {
  return (
    text.charCodeAt(i) === 47 && (text.charCodeAt(i + 1) === 47 || text.charCodeAt(i + 1) === 42)
  )
}

/** Describes the token at `i` for "unexpected …" messages. */
function tokenAt(text: string, i: number): string {
  const c = text.charCodeAt(i)
  if ('{}[],:"'.includes(text[i])) return text[i]
  WORD.lastIndex = i
  const w = WORD.exec(text)
  if (w) return w[0]
  return String.fromCodePoint(text.codePointAt(i) ?? c)
}

function valueError(text: string, i: number, afterComma: number): JsonSyntaxError {
  const c = text.charCodeAt(i)
  if ((c === 93 || c === 125) && afterComma >= 0) return { code: 'trailing-comma', pos: afterComma }
  if (c === 45 || (c >= 48 && c <= 57) || c === 46 || c === 43) {
    return {
      code: 'bad-number',
      pos: i,
      end: tokenEnd(text, i),
      found: text.slice(i, tokenEnd(text, i)),
    }
  }
  WORD.lastIndex = i
  const w = WORD.exec(text)
  if (w) return { code: 'bad-literal', pos: i, end: i + w[0].length, found: w[0] }
  if (c === 39) return { code: 'unexpected-token', pos: i, found: "'" }
  return { code: 'unexpected-token', pos: i, found: tokenAt(text, i) }
}

/**
 * Returns the first syntax error of `text`, or null when it is valid JSON.
 * Mirrors JSON.parse (RFC 8259): no comments, no trailing commas, double-quoted keys.
 */
export function findJsonError(text: string): JsonSyntaxError | null {
  const n = text.length
  let i = skipWs(text, 0)
  if (i >= n) return { code: 'empty', pos: 0 }
  const stack: number[] = []
  // What the grammar expects next.
  let expect: 'value' | 'value-or-close' | 'key' | 'key-or-close' | 'after-value' = 'value'
  // Position of the comma just consumed (for "trailing comma"), or -1.
  let comma = -1

  for (;;) {
    const beforeWs = i
    i = skipWs(text, i)
    if (i < n && isCommentStart(text, i)) return { code: 'comment', pos: i, end: i + 2 }
    if (i >= n) {
      if (expect === 'after-value' && stack.length === 0) return null
      return { code: 'unexpected-end', pos: n }
    }
    const c = text.charCodeAt(i)

    if (expect === 'value' || expect === 'value-or-close') {
      if (expect === 'value-or-close' && c === 93) {
        stack.pop()
        i++
        expect = 'after-value'
        continue
      }
      if (c === 123) {
        stack.push(OBJ)
        i++
        expect = 'key-or-close'
        comma = -1
        continue
      }
      if (c === 91) {
        stack.push(ARR)
        i++
        expect = 'value-or-close'
        comma = -1
        continue
      }
      if (c === 34) {
        const r = scanString(text, i)
        if ('error' in r) return r.error
        i = r.end
        expect = 'after-value'
        continue
      }
      if (c === 45 || (c >= 48 && c <= 57)) {
        NUMBER.lastIndex = i
        const m = NUMBER.exec(text)
        const end = m ? i + m[0].length : i
        if (!m || !isDelimiter(text.charCodeAt(end))) {
          const stop = tokenEnd(text, i)
          return { code: 'bad-number', pos: i, end: stop, found: text.slice(i, stop) }
        }
        i = end
        expect = 'after-value'
        continue
      }
      WORD.lastIndex = i
      const w = WORD.exec(text)
      if (w && (w[0] === 'true' || w[0] === 'false' || w[0] === 'null')) {
        i += w[0].length
        expect = 'after-value'
        continue
      }
      return valueError(text, i, comma)
    }

    if (expect === 'key' || expect === 'key-or-close') {
      if (c === 125) {
        if (expect === 'key') return { code: 'trailing-comma', pos: comma }
        stack.pop()
        i++
        expect = 'after-value'
        continue
      }
      if (c !== 34) {
        return {
          code: 'expected-property',
          pos: i,
          end: tokenEnd(text, i),
          found: tokenAt(text, i),
        }
      }
      const r = scanString(text, i)
      if ('error' in r) return r.error
      i = skipWs(text, r.end)
      if (text.charCodeAt(i) !== 58) {
        return i >= n
          ? { code: 'unexpected-end', pos: n }
          : { code: 'expected-colon', pos: i, found: tokenAt(text, i) }
      }
      i++
      expect = 'value'
      comma = -1
      continue
    }

    // after-value
    if (stack.length === 0) return { code: 'trailing-content', pos: i, end: n }
    const top = stack[stack.length - 1]
    if (c === 44) {
      comma = i
      i++
      expect = top === OBJ ? 'key' : 'value'
      continue
    }
    if ((top === OBJ && c === 125) || (top === ARR && c === 93)) {
      stack.pop()
      i++
      continue
    }
    const code = top === OBJ ? 'expected-comma-object' : 'expected-comma-array'
    // A value on the next line almost always means a comma is missing at the end of this one:
    // point there (zero-length) rather than at the next token.
    if (text.slice(beforeWs, i).includes('\n'))
      return { code, pos: beforeWs, end: beforeWs, found: tokenAt(text, i) }
    return { code, pos: i, found: tokenAt(text, i) }
  }
}

/* -------------------------------------------------------------------------- */
/*                               Path location                                */
/* -------------------------------------------------------------------------- */

export interface PathRange {
  /** Range of the value. */
  from: number
  to: number
  /** Start of the property name (`"key"`) when the value is an object member. */
  keyFrom?: number
}

function skipString(text: string, i: number): number {
  let from = i + 1
  for (;;) {
    const q = text.indexOf('"', from)
    if (q < 0) return text.length
    let slashes = 0
    for (let b = q - 1; text.charCodeAt(b) === 92; b--) slashes++
    if (slashes % 2 === 0) return q + 1
    from = q + 1
  }
}

/** Skips one value starting at `i`; returns the index after it. Tolerant of bad input. */
function skipValue(text: string, i: number): number {
  const c = text.charCodeAt(i)
  if (c === 34) return skipString(text, i)
  if (c === 123 || c === 91) {
    let depth = 0
    const n = text.length
    while (i < n) {
      const ch = text.charCodeAt(i)
      if (ch === 34) {
        i = skipString(text, i)
        continue
      }
      if (ch === 123 || ch === 91) depth++
      else if (ch === 125 || ch === 93) {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    return n
  }
  while (i < text.length && !isDelimiter(text.charCodeAt(i))) i++
  return i
}

/**
 * Finds the text range of the value at `path` (object keys and array indices), or null when
 * the path does not exist. Assumes the text is (mostly) valid JSON.
 */
export function findPathRange(text: string, path: NodePath): PathRange | null {
  let i = skipWs(text, 0)
  let keyFrom: number | undefined
  for (const seg of path) {
    const c = text.charCodeAt(i)
    keyFrom = undefined
    if (typeof seg === 'string') {
      if (c !== 123) return null
      i = skipWs(text, i + 1)
      let found = false
      while (text.charCodeAt(i) === 34) {
        const keyStart = i
        const keyEnd = skipString(text, i)
        let key: unknown
        try {
          key = JSON.parse(text.slice(keyStart, keyEnd))
        } catch {
          return null
        }
        i = skipWs(text, keyEnd)
        if (text.charCodeAt(i) !== 58) return null
        i = skipWs(text, i + 1)
        if (key === seg) {
          found = true
          keyFrom = keyStart
          break
        }
        i = skipWs(text, skipValue(text, i))
        if (text.charCodeAt(i) !== 44) return null
        i = skipWs(text, i + 1)
      }
      if (!found) return null
    } else {
      if (c !== 91 || seg < 0) return null
      i = skipWs(text, i + 1)
      if (text.charCodeAt(i) === 93) return null
      for (let n = 0; n < seg; n++) {
        i = skipWs(text, skipValue(text, i))
        if (text.charCodeAt(i) !== 44) return null
        i = skipWs(text, i + 1)
      }
      if (text.charCodeAt(i) === 93 || i >= text.length) return null
    }
  }
  if (i >= text.length) return null
  return { from: i, to: skipValue(text, i), keyFrom }
}

/* -------------------------------------------------------------------------- */
/*                                Presentation                                */
/* -------------------------------------------------------------------------- */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** JavaScript accessor for a path: ['layers', 3, 'ks', 'p'] → "layers[3].ks.p". */
export function pathToAccessor(path: NodePath): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else if (IDENTIFIER.test(seg)) out += out ? `.${seg}` : seg
    else out += `[${JSON.stringify(seg)}]`
  }
  return out
}
