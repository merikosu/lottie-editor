/**
 * Evaluates simple arithmetic typed into number fields: "100+20", "50 * 2", "(1+2)/3", "-5".
 * Only numbers, + - * / % and parentheses are accepted. Returns null for invalid input.
 */
export function evaluateExpression(input: string): number | null {
  const src = input.replace(/,/g, '.').replace(/\s+/g, '')
  if (!src) return null
  if (!/^[\d.+\-*/%()eE]+$/.test(src)) return null
  let pos = 0

  const peek = () => src[pos]
  const parseNumber = (): number | null => {
    const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(pos))
    if (!m) return null
    pos += m[0].length
    return Number(m[0])
  }
  const parseFactor = (): number | null => {
    const c = peek()
    if (c === '+') {
      pos++
      return parseFactor()
    }
    if (c === '-') {
      pos++
      const v = parseFactor()
      return v === null ? null : -v
    }
    if (c === '(') {
      pos++
      const v = parseSum()
      if (peek() !== ')') return null
      pos++
      return v
    }
    return parseNumber()
  }
  const parseProduct = (): number | null => {
    let left = parseFactor()
    while (left !== null && (peek() === '*' || peek() === '/' || peek() === '%')) {
      const op = src[pos++]
      const right = parseFactor()
      if (right === null) return null
      left = op === '*' ? left * right : op === '/' ? left / right : left % right
    }
    return left
  }
  const parseSum = (): number | null => {
    let left = parseProduct()
    while (left !== null && (peek() === '+' || peek() === '-')) {
      const op = src[pos++]
      const right = parseProduct()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  const result = parseSum()
  if (result === null || pos !== src.length || !Number.isFinite(result)) return null
  return result
}
