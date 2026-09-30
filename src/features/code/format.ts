/**
 * Compact, deterministic JSON formatting for the code view.
 *
 * - Two-space indentation; arrays and objects that fit on one line stay inline, so colors,
 *   vectors and easing handles read as `[1, 0.5, 0.2, 1]` instead of six lines each. For
 *   Lottie this is about 2.3× smaller than `JSON.stringify(v, null, 2)` (measured: a 5.3 MB
 *   file becomes 15.9 MB / 440k lines instead of 36.6 MB / 1.2M lines).
 * - Re-formatting is incremental: documents are immutable and share unchanged subtrees, so
 *   the text of children of large containers is cached by object identity. After a small
 *   edit only the path from the root to the change is formatted again.
 */

export interface FormatOptions {
  /** Maximum line width for inline containers (default 100). */
  width?: number
}

const INDENT = '  '
const DEFAULT_WIDTH = 100
/** Containers at least this long cache the text of their children… */
const CACHE_CHILDREN_OF = 16 * 1024
/** …when a child is at least this long (smaller ones are cheaper to redo than to look up). */
const MIN_CACHED = 512

interface CacheEntry {
  level: number
  col: number
  width: number
  text: string
}

const cache = new WeakMap<object, CacheEntry>()
const quotedKeys = new Map<string, string>()

function quoteKey(key: string): string {
  let q = quotedKeys.get(key)
  if (q === undefined) {
    q = JSON.stringify(key)
    if (quotedKeys.size < 4096) quotedKeys.set(key, q)
  }
  return q
}

/** JSON text of a primitive, or undefined for values JSON.stringify skips. */
function primitive(v: unknown): string | undefined {
  switch (typeof v) {
    case 'number':
      return Number.isFinite(v) ? String(v) : 'null'
    case 'string':
      return JSON.stringify(v)
    case 'boolean':
      return v ? 'true' : 'false'
    case 'bigint':
      return String(v)
    case 'object':
      return v === null ? 'null' : undefined
    default:
      return undefined
  }
}

function isSkipped(v: unknown): boolean {
  return v === undefined || typeof v === 'function' || typeof v === 'symbol'
}

/**
 * Length of the one-line form of `v`, or -1 as soon as it exceeds `budget`. Bails out early,
 * so checking whether a huge subtree fits costs at most `budget` characters of work.
 */
function inlineLength(v: unknown, budget: number): number {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'string') {
      if (v.length + 2 > budget) return -1
      return JSON.stringify(v).length
    }
    const p = primitive(v)
    return p === undefined ? 4 : p.length
  }
  let len = 2
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (i > 0) len += 2
      if (len > budget) return -1
      const item = v[i]
      const c = isSkipped(item) ? 4 : inlineLength(item, budget - len)
      if (c < 0) return -1
      len += c
    }
    return len <= budget ? len : -1
  }
  let first = true
  for (const key in v) {
    if (!Object.hasOwn(v, key)) continue
    const value = (v as Record<string, unknown>)[key]
    if (isSkipped(value)) continue
    if (!first) len += 2
    first = false
    len += quoteKey(key).length + 2
    if (len > budget) return -1
    const c = inlineLength(value, budget - len)
    if (c < 0) return -1
    len += c
  }
  return len <= budget ? len : -1
}

function inline(v: unknown): string {
  if (v === null || typeof v !== 'object') return primitive(v) ?? 'null'
  if (Array.isArray(v)) {
    let out = '['
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out += ', '
      out += isSkipped(v[i]) ? 'null' : inline(v[i])
    }
    return out + ']'
  }
  let out = '{'
  let first = true
  for (const key in v) {
    if (!Object.hasOwn(v, key)) continue
    const value = (v as Record<string, unknown>)[key]
    if (isSkipped(value)) continue
    if (!first) out += ', '
    first = false
    out += quoteKey(key) + ': ' + inline(value)
  }
  return out + '}'
}

function indentOf(level: number): string {
  return INDENT.repeat(level)
}

/** Formats `v` whose first character is at column `col` on a line indented `level` times. */
function formatValue(v: unknown, level: number, col: number, width: number): string {
  if (v === null || typeof v !== 'object') return primitive(v) ?? 'null'
  const hit = cache.get(v)
  if (hit && hit.level === level && hit.col === col && hit.width === width) return hit.text
  // Reserve one column for the comma that usually follows.
  if (inlineLength(v, width - col - 1) >= 0) return inline(v)

  const pad = indentOf(level + 1)
  const childCol = pad.length
  const parts: string[] = []
  const children: { value: object; level: number; col: number; text: string }[] = []

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    for (const item of v) {
      const text = isSkipped(item) ? 'null' : formatValue(item, level + 1, childCol, width)
      parts.push(pad + text)
      if (item !== null && typeof item === 'object')
        children.push({ value: item, level: level + 1, col: childCol, text })
    }
  } else {
    for (const key in v) {
      if (!Object.hasOwn(v, key)) continue
      const value = (v as Record<string, unknown>)[key]
      if (isSkipped(value)) continue
      const prefix = quoteKey(key) + ': '
      const valueCol = childCol + prefix.length
      const text = formatValue(value, level + 1, valueCol, width)
      parts.push(pad + prefix + text)
      if (value !== null && typeof value === 'object')
        children.push({ value, level: level + 1, col: valueCol, text })
    }
    if (parts.length === 0) return '{}'
  }

  const open = Array.isArray(v) ? '[' : '{'
  const close = Array.isArray(v) ? ']' : '}'
  const text = `${open}\n${parts.join(',\n')}\n${indentOf(level)}${close}`

  if (text.length >= CACHE_CHILDREN_OF) {
    for (const c of children) {
      // Only immutable (store) objects are safe cache keys.
      if (c.text.length >= MIN_CACHED && Object.isFrozen(c.value)) {
        cache.set(c.value, { level: c.level, col: c.col, width, text: c.text })
      }
    }
  }
  return text
}

/** Formats a JSON value (compact pretty-printing, see the module comment). */
export function formatJson(value: unknown, opts: FormatOptions = {}): string {
  return formatValue(value, 0, 0, opts.width ?? DEFAULT_WIDTH)
}

/* -------------------------------------------------------------------------- */
/*                                    Diff                                    */
/* -------------------------------------------------------------------------- */

export interface TextChange {
  from: number
  to: number
  insert: string
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff

/**
 * Common-prefix and suffix scans compare 16K-character slices natively (slices are O(1)
 * views and `===` is a memcmp) before finishing char by char: ~50× faster than a plain loop
 * on multi-megabyte texts (16 MB: ~50 ms → ~1 ms).
 */
const CHUNK = 1 << 14

function commonPrefix(a: string, b: string, max: number): number {
  let i = 0
  while (i + CHUNK <= max && a.slice(i, i + CHUNK) === b.slice(i, i + CHUNK)) i += CHUNK
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

function commonSuffix(a: string, b: string, max: number): number {
  let n = 0
  while (
    n + CHUNK <= max &&
    a.slice(a.length - n - CHUNK, a.length - n) === b.slice(b.length - n - CHUNK, b.length - n)
  ) {
    n += CHUNK
  }
  while (n < max && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n++
  return n
}

/**
 * The single replacement (common prefix and suffix removed) that turns `a` into `b`, or null
 * when they are equal. Keeps editor state outside the change (scroll, folds, cursor) intact.
 */
export function diffText(a: string, b: string): TextChange | null {
  if (a === b) return null
  let start = commonPrefix(a, b, Math.min(a.length, b.length))
  // Never split a surrogate pair.
  if (start > 0 && isHighSurrogate(a.charCodeAt(start - 1))) start--
  const suffix = commonSuffix(a, b, Math.min(a.length, b.length) - start)
  let endA = a.length - suffix
  let endB = b.length - suffix
  if (endA < a.length && isLowSurrogate(a.charCodeAt(endA))) {
    endA++
    endB++
  }
  return { from: start, to: endA, insert: b.slice(start, endB) }
}

const NON_ASCII = /[^\x00-\x7f]+/g // oxlint-disable-line no-control-regex -- ASCII range boundary

/** UTF-8 byte length of a string (the size the text would have on disk). */
export function utf8Length(text: string): number {
  // Every character is at least one byte; only non-ASCII runs (rare in JSON) need a closer look.
  let bytes = text.length
  NON_ASCII.lastIndex = 0
  for (let m = NON_ASCII.exec(text); m; m = NON_ASCII.exec(text)) {
    const run = m[0]
    for (let i = 0; i < run.length; i++) {
      const c = run.charCodeAt(i)
      if (c < 0x800) bytes += 1
      else if (isHighSurrogate(c) && i + 1 < run.length && isLowSurrogate(run.charCodeAt(i + 1))) {
        // A surrogate pair is 2 code units and 4 bytes.
        bytes += 2
        i++
      } else bytes += 2
    }
  }
  return bytes
}
