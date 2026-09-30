/**
 * A small CSS engine for SVG `<style>` sheets and `style` attributes, enough for real exports
 * (Illustrator `.st0{fill:#fff}`, Inkscape inline styles, Figma/Sketch classes):
 *  - rules with grouped selectors; any selector the DOM can match (`Element.matches`)
 *  - specificity and source order, `!important`, inline styles
 *  - comments, strings, `url(data:…;…)` values; at-rules are skipped (`@media` blocks are not
 *    applied: the importer renders the default, unconditional appearance)
 */

export interface CssDeclaration {
  /** Lowercase property name. */
  prop: string
  value: string
  important: boolean
}

export interface CssRule {
  selector: string
  /** Packed specificity: ids · 1e6 + classes · 1e3 + types. */
  specificity: number
  /** Source order across all sheets. */
  order: number
  decls: CssDeclaration[]
  /** Cheap pre-filter extracted from the rightmost compound selector. */
  key: SelectorKey
}

export interface SelectorKey {
  id?: string
  classes: string[]
  tag?: string
}

/** Removes comments, keeping strings intact. */
function stripComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'") {
      const end = findStringEnd(text, i)
      out += text.slice(i, end)
      i = end
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      out += ' '
    } else {
      out += c
      i++
    }
  }
  return out
}

function findStringEnd(text: string, start: number): number {
  const quote = text[start]
  let i = start + 1
  while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1
  return Math.min(text.length, i + 1)
}

/** Index of the matching closing brace for the `{` at `open`, respecting strings. */
function findBlockEnd(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") i = findStringEnd(text, i) - 1
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return text.length
}

/** Splits on `sep` at nesting depth 0 (outside strings, parentheses and brackets). */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") i = findStringEnd(text, i) - 1
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (c === sep && depth === 0) {
      parts.push(text.slice(last, i))
      last = i + 1
    }
  }
  parts.push(text.slice(last))
  return parts
}

/** Parses a declaration block (`fill: red; stroke: blue !important`). */
export function parseDeclarations(text: string | null | undefined): CssDeclaration[] {
  if (!text) return []
  const out: CssDeclaration[] = []
  for (const part of splitTopLevel(stripComments(text), ';')) {
    const colon = part.indexOf(':')
    if (colon <= 0) continue
    const prop = part.slice(0, colon).trim().toLowerCase()
    let value = part.slice(colon + 1).trim()
    if (!prop || !value) continue
    const important = /!\s*important\s*$/i.test(value)
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim()
    if (value) out.push({ prop, value, important })
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                 Specificity                                */
/* -------------------------------------------------------------------------- */

const IDENT_RE = /^-?(?:[_a-zA-Z -￿]|\\.)(?:[-_a-zA-Z0-9 -￿]|\\.)*/

/** Content of the parenthesized group starting at `open`, and the index after it. */
function readParens(sel: string, open: number): [string, number] {
  let depth = 0
  for (let i = open; i < sel.length; i++) {
    if (sel[i] === '(') depth++
    else if (sel[i] === ')' && --depth === 0) return [sel.slice(open + 1, i), i + 1]
  }
  return [sel.slice(open + 1), sel.length]
}

/** Specificity (a, b, c) of a complex selector, packed as a·1e6 + b·1e3 + c. */
export function selectorSpecificity(selector: string): number {
  let a = 0
  let b = 0
  let c = 0
  let i = 0
  let compoundStart = true
  const sel = selector.trim()
  while (i < sel.length) {
    const ch = sel[i]
    if (ch === '#' || ch === '.') {
      const m = IDENT_RE.exec(sel.slice(i + 1))
      if (ch === '#') a++
      else b++
      i += 1 + (m ? m[0].length : 0)
      compoundStart = false
    } else if (ch === '[') {
      const end = sel.indexOf(']', i)
      b++
      i = end < 0 ? sel.length : end + 1
      compoundStart = false
    } else if (ch === ':') {
      const element = sel[i + 1] === ':'
      i += element ? 2 : 1
      const m = IDENT_RE.exec(sel.slice(i))
      const name = m ? m[0].toLowerCase() : ''
      i += name.length
      let args: string | null = null
      if (sel[i] === '(') [args, i] = readParens(sel, i)
      if (element) c++
      else if (name === 'where') {
        // :where() adds nothing.
      } else if (
        (name === 'is' || name === 'not' || name === 'has' || name === 'matches') &&
        args !== null
      ) {
        const inner = Math.max(0, ...splitTopLevel(args, ',').map(selectorSpecificity))
        a += Math.floor(inner / 1e6)
        b += Math.floor((inner % 1e6) / 1e3)
        c += inner % 1e3
      } else b++
      compoundStart = false
    } else if (ch === '*') {
      i++
      compoundStart = false
    } else if (/[\s>+~]/.test(ch)) {
      i++
      compoundStart = true
    } else {
      const m = IDENT_RE.exec(sel.slice(i))
      if (!m) {
        i++
        continue
      }
      if (compoundStart) c++
      i += m[0].length
      compoundStart = false
    }
  }
  return a * 1e6 + Math.min(b, 999) * 1e3 + Math.min(c, 999)
}

/** Required id / classes / tag of the rightmost compound selector (a cheap pre-filter). */
export function selectorKey(selector: string): SelectorKey {
  const parts = selector.trim().split(/\s*[\s>+~]\s*/)
  const last = parts[parts.length - 1] ?? ''
  // Only a plain compound (no pseudo-classes, attributes or escapes) gives a reliable key.
  if (!/^[-_a-zA-Z0-9#.*| -￿]*$/.test(last)) return { classes: [] }
  const key: SelectorKey = { classes: [] }
  const tag = /^[-_a-zA-Z][-_a-zA-Z0-9]*/.exec(last)
  if (tag && !last.includes('|')) key.tag = tag[0]
  for (const m of last.matchAll(/([#.])(-?[_a-zA-Z -￿][-_a-zA-Z0-9 -￿]*)/g)) {
    if (m[1] === '#') key.id = m[2]
    else key.classes.push(m[2])
  }
  return key
}

/* -------------------------------------------------------------------------- */
/*                                 Stylesheets                                */
/* -------------------------------------------------------------------------- */

export interface StylesheetParse {
  rules: CssRule[]
  /** At-rules that were skipped (e.g. "@media"), for warnings. */
  skippedAtRules: string[]
}

/**
 * Parses a stylesheet into one rule per selector (grouped selectors are split). `firstOrder`
 * continues the source order across several `<style>` elements.
 */
export function parseStylesheet(text: string, firstOrder = 0): StylesheetParse {
  const css = stripComments(text)
  const rules: CssRule[] = []
  const skippedAtRules: string[] = []
  let order = firstOrder
  let i = 0
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++
    if (i >= css.length) break
    if (css.startsWith('<!--', i) || css.startsWith('-->', i)) {
      i += css[i] === '<' ? 4 : 3
      continue
    }
    if (css[i] === '@') {
      const name = /^@[-a-zA-Z]+/.exec(css.slice(i))?.[0] ?? '@'
      let j = i
      while (j < css.length && css[j] !== '{' && css[j] !== ';') {
        if (css[j] === '"' || css[j] === "'") j = findStringEnd(css, j)
        else j++
      }
      if (css[j] === '{') {
        const end = findBlockEnd(css, j)
        // Rules inside @media / @supports are conditional: not applied. @font-face etc.: no rules.
        if (/^@(media|supports|container|layer|document)$/i.test(name))
          skippedAtRules.push(name.toLowerCase())
        i = end + 1
      } else i = j + 1
      continue
    }
    const open = css.indexOf('{', i)
    if (open < 0) break
    const end = findBlockEnd(css, open)
    const prelude = css.slice(i, open).trim()
    const decls = parseDeclarations(css.slice(open + 1, end))
    if (prelude && decls.length > 0) {
      for (const raw of splitTopLevel(prelude, ',')) {
        const selector = raw.trim()
        if (!selector) continue
        rules.push({
          selector,
          specificity: selectorSpecificity(selector),
          order: order++,
          decls,
          key: selectorKey(selector),
        })
      }
    }
    i = end + 1
  }
  return { rules, skippedAtRules }
}

/** True if the element can match the rule's rightmost compound (before calling `matches`). */
export function keyAllows(key: SelectorKey, el: Element): boolean {
  if (key.id !== undefined && el.getAttribute('id') !== key.id) return false
  if (key.tag !== undefined && key.tag !== '*' && el.localName !== key.tag) return false
  if (key.classes.length > 0) {
    const cls = ` ${(el.getAttribute('class') ?? '').trim().split(/\s+/).join(' ')} `
    for (const c of key.classes) if (!cls.includes(` ${c} `)) return false
  }
  return true
}
