/**
 * Text layer helpers: text documents (`t.d.k[].s`), the fonts list and glyph checks.
 *
 * Text documents are keyframed ("source text" in After Effects) but never interpolate:
 * lottie-web shows the last keyframe at or before the frame. Line breaks are stored as "\r"
 * (lottie-web also accepts "\u0003"); a "\n" is laid out as a regular character, so text
 * coming from a <textarea> must be converted with `textFromEditor`.
 *
 * Mutating functions are meant to run inside `updateDoc` recipes.
 */
import type { NodePath } from './path'
import { forEachLayer } from './traverse'
import type { Animation, Font, TextData, TextDocument, TextLayer } from './types'
import { isTextLayer } from './types'

export interface TextKeyframe {
  s: TextDocument
  t: number
}

/* -------------------------------------------------------------------------- */
/*                                 Line breaks                                */
/* -------------------------------------------------------------------------- */

/** End-of-text character: lottie-web also treats it as a line break. */
const ETX = String.fromCharCode(3)

/** Stored text ("\r", "\r\n" or ETX line breaks) → editor text ("\n"). */
export function textToEditor(text: string | undefined): string {
  return (text ?? '')
    .split(ETX)
    .join('\n')
    .replace(/\r\n|\r/g, '\n')
}

/** Editor text ("\n" or "\r\n") → stored text ("\r", the form every player understands). */
export function textFromEditor(text: string): string {
  return text
    .split(ETX)
    .join('\r')
    .replace(/\r\n|\n/g, '\r')
}

/* -------------------------------------------------------------------------- */
/*                               Text documents                               */
/* -------------------------------------------------------------------------- */

/** Keyframes of a text document; empty for malformed layers. */
export function textKeyframes(text: TextData | null | undefined): TextKeyframe[] {
  const k = text?.d?.k
  return Array.isArray(k)
    ? k.filter((kf): kf is TextKeyframe => !!kf && typeof kf.s === 'object' && kf.s !== null)
    : []
}

/**
 * Index (in `t.d.k`) of the keyframe displayed at `frame` (comp time): the last one with
 * `t <= frame`, or the first keyframe before it. -1 when there is no keyframe.
 */
export function textKeyframeIndexAt(text: TextData | null | undefined, frame: number): number {
  const k = text?.d?.k
  if (!Array.isArray(k) || k.length === 0) return -1
  let index = 0
  for (let i = 0; i < k.length; i++) {
    if (typeof k[i]?.t === 'number' && k[i].t <= frame) index = i
    else break
  }
  return index
}

/** True when the text content is the same on every keyframe (so one edit can apply to all). */
export function hasUniformText(text: TextData | null | undefined): boolean {
  const kfs = textKeyframes(text)
  return kfs.every((kf) => (kf.s.t ?? '') === (kfs[0]?.s.t ?? ''))
}

/** Which keyframes an edit applies to: every keyframe, or one keyframe index. */
export type TextScope = 'all' | number

function scopedDocuments(text: TextData, scope: TextScope): TextDocument[] {
  const k = text.d?.k
  if (!Array.isArray(k)) return []
  if (scope === 'all')
    return k.map((kf) => kf?.s).filter((s): s is TextDocument => !!s && typeof s === 'object')
  const s = k[scope]?.s
  return s && typeof s === 'object' ? [s] : []
}

/**
 * Sets the text content. Accepts editor text ("\n" line breaks) and stores "\r".
 * Mutates `text`.
 */
export function setTextContent(text: TextData, content: string, scope: TextScope = 'all'): void {
  const stored = textFromEditor(content)
  for (const doc of scopedDocuments(text, scope)) doc.t = stored
}

/**
 * Applies style fields (size, font, colors, justification…) to the text documents in scope.
 * A field set to `undefined` in `patch` is removed (e.g. removing the stroke). Mutates `text`.
 */
export function patchTextDocument(
  text: TextData,
  patch: Partial<TextDocument>,
  scope: TextScope = 'all',
): void {
  const entries = Object.entries(patch) as [keyof TextDocument, unknown][]
  for (const doc of scopedDocuments(text, scope)) {
    const target = doc as unknown as Record<string, unknown>
    for (const [key, value] of entries) {
      if (value === undefined) delete target[key]
      // Arrays (colors, box sizes) are copied so documents never share references.
      else target[key] = Array.isArray(value) ? [...value] : value
    }
  }
}

/** Justification values understood by lottie-web (other After Effects modes fall back to left). */
export const TextJustify = { Left: 0, Right: 1, Center: 2 } as const

/* -------------------------------------------------------------------------- */
/*                                 Text layers                                */
/* -------------------------------------------------------------------------- */

export interface TextLayerRef {
  layer: TextLayer
  path: NodePath
  /** Asset index of the containing precomp, or null for the root composition. */
  assetIndex: number | null
  /** Name of the containing composition ('' for the root). */
  compName: string
}

/** Every text layer in the document (root composition first, then precomps). */
export function listTextLayers(anim: Animation): TextLayerRef[] {
  const out: TextLayerRef[] = []
  forEachLayer(anim, (layer, path, comp) => {
    if (isTextLayer(layer)) {
      out.push({
        layer,
        path,
        assetIndex: comp.assetIndex,
        compName: comp.assetIndex === null ? '' : comp.name,
      })
    }
  })
  return out
}

/* -------------------------------------------------------------------------- */
/*                                    Fonts                                   */
/* -------------------------------------------------------------------------- */

/** Fonts declared in the document (`fonts.list`). */
export function listFonts(anim: Animation): Font[] {
  const list = anim.fonts?.list
  return Array.isArray(list)
    ? list.filter((f): f is Font => !!f && typeof f.fName === 'string')
    : []
}

/** Finds a font by its `fName` (the value text documents reference in `f`). */
export function findFont(anim: Animation, fName: string | undefined): Font | undefined {
  if (!fName) return undefined
  return listFonts(anim).find((f) => f.fName === fName)
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

/**
 * Families of a CSS font stack ("Inter Variable, Inter, sans-serif" → three entries).
 * lottie-web writes `fFamily` into CSS as is, so stacks are valid.
 */
export function fontStack(family: string | undefined): string[] {
  return (family ?? '')
    .split(',')
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter(Boolean)
}

/** True for CSS generic families (`sans-serif`, `system-ui`, …), which always resolve to some font. */
export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family.toLowerCase())
}

/**
 * CSS `font-family` value for a family or stack: named families quoted, generic ones bare
 * (`Inter Variable, sans-serif` → `"Inter Variable", sans-serif`), then `fallback` if given.
 */
export function cssFontFamily(family: string | undefined, fallback?: string): string {
  const parts = fontStack(family).map((f) =>
    isGenericFamily(f) ? f : `"${f.replace(/["\\]/g, '')}"`,
  )
  if (fallback) parts.push(fallback)
  return parts.join(', ')
}

/** Human-readable font name: "Inter Bold"; falls back to the fName. */
export function fontLabel(font: Pick<Font, 'fName' | 'fFamily' | 'fStyle'>): string {
  const family = fontStack(font.fFamily)[0]
  if (!family) return font.fName
  const style = font.fStyle?.trim()
  return style && !/^(regular|normal|roman|book)$/i.test(style) ? `${family} ${style}` : family
}

/** CSS font family used to render a text document's font (lottie-web falls back to fName). */
export function fontFamilyFor(anim: Animation, fName: string | undefined): string {
  const font = findFont(anim, fName) ?? listFonts(anim)[0]
  return font?.fFamily?.trim() || font?.fName || fName || 'sans-serif'
}

export interface NewFontOptions {
  family: string
  style?: string
  /** CSS weight, e.g. "700". */
  weight?: string
  /** Ascent as a percentage of the font size (used for the first baseline of box text). */
  ascent?: number
}

function fontKey(family: string, style: string): string {
  return `${family.trim().toLowerCase()}|${style.trim().toLowerCase()}`
}

/**
 * Adds a font to `fonts.list` (creating the list when missing) and returns its fName.
 * When a font with the same family and style already exists, its fName is returned instead.
 * Mutates `anim`.
 */
export function addFont(anim: Animation, opts: NewFontOptions): string {
  const family = opts.family.trim()
  const style = (opts.style ?? 'Regular').trim() || 'Regular'
  if (!family) throw new Error('addFont: the family name is empty')
  const fonts = listFonts(anim)
  const existing = fonts.find(
    (f) => fontKey(f.fFamily ?? '', f.fStyle ?? 'Regular') === fontKey(family, style),
  )
  if (existing) return existing.fName

  const base = `${family}-${style}`.replace(/\s+/g, '')
  const taken = new Set(fonts.map((f) => f.fName))
  let fName = base
  for (let n = 2; taken.has(fName); n++) fName = `${base}-${n}`

  const font: Font = {
    fName,
    fFamily: family,
    fStyle: style,
    fWeight: opts.weight ?? '',
    // bodymovin's marker for "installed on the system" (no URL to load the font from).
    fOrigin: 'n',
    ascent: opts.ascent ?? 75,
  }
  if (!anim.fonts || !Array.isArray(anim.fonts.list)) anim.fonts = { list: [] }
  anim.fonts.list.push(font)
  return fName
}

/** Number of text layers (all compositions) referencing each fName on any keyframe. */
export function fontUsage(anim: Animation): Map<string, number> {
  const usage = new Map<string, number>()
  for (const { layer } of listTextLayers(anim)) {
    const names = new Set(textKeyframes(layer.t).map((kf) => kf.s.f))
    for (const name of names) if (name) usage.set(name, (usage.get(name) ?? 0) + 1)
  }
  return usage
}

/* -------------------------------------------------------------------------- */
/*                                   Glyphs                                   */
/* -------------------------------------------------------------------------- */

interface GlyphChar {
  ch?: string
  fFamily?: string
  style?: string
}

function glyphChars(anim: Animation): GlyphChar[] {
  return Array.isArray(anim.chars)
    ? (anim.chars as GlyphChar[]).filter((c) => !!c && typeof c.ch === 'string')
    : []
}

/**
 * True when the document renders text from embedded glyph outlines (`chars`) instead of
 * fonts. Such text can only show the characters that were exported.
 */
export function usesGlyphs(anim: Animation): boolean {
  return glyphChars(anim).length > 0
}

const IGNORED_CHARS = new Set(['\r', '\n', ETX])

/**
 * Characters of `text` that have no glyph for `font` in `chars` (lottie-web matches the
 * character, the font family and the style). Empty when the document has no glyphs.
 */
export function missingGlyphs(
  anim: Animation,
  text: string,
  font: Pick<Font, 'fFamily' | 'fStyle'> | undefined,
): string[] {
  const chars = glyphChars(anim)
  if (chars.length === 0) return []
  const family = font?.fFamily
  const style = font?.fStyle
  const available = new Set(
    chars
      .filter((c) => (!family || c.fFamily === family) && (!style || c.style === style))
      .map((c) => c.ch as string),
  )
  const missing: string[] = []
  for (const ch of new Set(Array.from(text))) {
    if (!IGNORED_CHARS.has(ch) && !available.has(ch)) missing.push(ch)
  }
  return missing
}
