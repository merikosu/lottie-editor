/**
 * Low-level scanning of SVG microsyntaxes: numbers (compact forms such as `1.5.5`, `1-2`,
 * `1e-3`), comma/whitespace separators, arc flags, number lists and CSS lengths.
 */

const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const WSP = new Set([' ', '\t', '\n', '\r', '\f'])

/** Cursor over a string of SVG numbers, following the SVG path/number-list grammar. */
export class NumberScanner {
  pos = 0
  readonly text: string

  constructor(text: string) {
    this.text = text
  }

  skipWhitespace(): void {
    while (this.pos < this.text.length && WSP.has(this.text[this.pos])) this.pos++
  }

  /** Skips whitespace and at most one comma (the `comma-wsp` production). */
  skipSeparator(): void {
    this.skipWhitespace()
    if (this.text[this.pos] === ',') {
      this.pos++
      this.skipWhitespace()
    }
  }

  atEnd(): boolean {
    this.skipWhitespace()
    return this.pos >= this.text.length
  }

  /** Next character after whitespace, without consuming it. */
  peek(): string {
    this.skipWhitespace()
    return this.text[this.pos] ?? ''
  }

  /** True when the next token starts a number. */
  atNumber(): boolean {
    const c = this.peek()
    return (c >= '0' && c <= '9') || c === '.' || c === '-' || c === '+'
  }

  /** Reads a number (after optional separators), or null without consuming anything. */
  number(): number | null {
    const start = this.pos
    this.skipSeparator()
    NUMBER_RE.lastIndex = this.pos
    const m = NUMBER_RE.exec(this.text)
    if (!m) {
      this.pos = start
      return null
    }
    const value = Number(m[0])
    if (!Number.isFinite(value)) {
      this.pos = start
      return null
    }
    this.pos += m[0].length
    return value
  }

  /** Reads an arc flag: a single `0` or `1`, which may be glued to the next number. */
  flag(): 0 | 1 | null {
    const start = this.pos
    this.skipSeparator()
    const c = this.text[this.pos]
    if (c === '0' || c === '1') {
      this.pos++
      return c === '1' ? 1 : 0
    }
    this.pos = start
    return null
  }
}

/** Parses a whitespace/comma separated number list, stopping at the first invalid token. */
export function parseNumberList(text: string | null | undefined): number[] {
  if (!text) return []
  const scanner = new NumberScanner(text)
  const out: number[] = []
  for (;;) {
    const n = scanner.number()
    if (n === null) break
    out.push(n)
  }
  return out
}

/** CSS absolute length units in px (96 dpi). */
const UNIT_PX: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  em: 16,
  rem: 16,
  ex: 8,
  ch: 8,
}

const LENGTH_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-z]+|%)?$/i

/**
 * Parses a length (`12`, `12px`, `3mm`, `50%`…) into user units. Percentages resolve
 * against `percentBase`; returns null for invalid values or `%` without a base.
 */
export function parseLength(value: string | null | undefined, percentBase?: number): number | null {
  if (value === null || value === undefined) return null
  const m = LENGTH_RE.exec(value.trim())
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2]?.toLowerCase()
  if (!unit) return n
  if (unit === '%') return percentBase === undefined ? null : (n / 100) * percentBase
  const k = UNIT_PX[unit]
  return k === undefined ? null : n * k
}

/** Parses a number or a percentage into a fraction (`0.5`, `50%` → 0.5). */
export function parseFraction(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const v = value.trim()
  if (v.endsWith('%')) {
    const n = Number(v.slice(0, -1))
    return v.length > 1 && Number.isFinite(n) ? n / 100 : null
  }
  const n = v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Angle with an optional CSS unit (deg by default) → degrees. */
export function parseAngle(value: string): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(deg|rad|grad|turn)?$/i.exec(
    value.trim(),
  )
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  switch (m[2]?.toLowerCase()) {
    case 'rad':
      return (n * 180) / Math.PI
    case 'grad':
      return n * 0.9
    case 'turn':
      return n * 360
    default:
      return n
  }
}
