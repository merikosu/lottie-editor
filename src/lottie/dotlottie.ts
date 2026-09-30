/**
 * dotLottie (`.lottie`) containers: reading and writing.
 *
 * A .lottie file is a ZIP archive with a `manifest.json`, one or more Lottie animations
 * (`animations/<id>.json` in v1, `a/<id>.json` in v2) and optional media, themes (`t/`) and
 * state machines (`s/`). The decisions below come from testing real players (see the research
 * notes on dotLottie):
 *
 * - Reading is tolerant: v1 and v2 layouts, missing or broken manifests, wrapping folders,
 *   `__MACOSX` junk, non-UTF-8 names and damaged central directories (salvaged by scanning local
 *   headers). Packaged images, fonts and audio are inlined as data URIs (`e: 1`) so lottie-web
 *   plays them directly.
 * - Writing produces archives every current player reads: `version` is a string, v1 `loop` is a
 *   boolean, v2 never gets a numeric `background`, the active animation comes first in the
 *   manifest and last in the archive, and images are extracted to `images/` (v1) or `i/` (v2)
 *   referenced as `u: "/images/"`, `p: "<file>"`, `e: 0`, de-duplicated by content.
 * - Round trips keep what the editor does not edit (other animations, themes, state machines,
 *   unknown files, manifest metadata) through the opaque container stored in the document meta.
 */
import {
  Unzip,
  UnzipInflate,
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
  type UnzipFileInfo,
  type ZipOptions,
  type Zippable,
} from 'fflate'
import type { Animation } from './types'

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

export type DotLottieVersion = 1 | 2

/** One animation of a .lottie archive. */
export interface DotLottieAnimation {
  /** Manifest id; the file name without `.json` (`a/<id>.json` or `animations/<id>.json`). */
  id: string
  /** Lottie JSON with every packaged asset inlined as a data URI (playable by lottie-web as is). */
  data: Animation
  /** Raw manifest entry: v1 playback hints, v2 `initialTheme`/`themes`, unknown fields. */
  meta: Record<string, unknown>
}

/** A theme (`t/<id>.json`) or state machine (`s/<id>.json`); the editor keeps them as opaque JSON. */
export interface DotLottieJsonEntry {
  id: string
  name?: string
  data: unknown
}

export type DotLottieWarningCode =
  /** The archive content sits inside a folder (`MyAnim/manifest.json`). */
  | 'nested-folder'
  /** No manifest.json: animations were found by scanning (normal for plain ZIP exports). */
  | 'no-manifest'
  /** manifest.json is not valid JSON or not an object. */
  | 'invalid-manifest'
  /** The manifest lists an animation whose file is missing. */
  | 'missing-animation'
  /** An animation file is not listed in the manifest (imported anyway). */
  | 'unlisted-animation'
  /** A JSON file that is not valid JSON or not a Lottie animation (skipped). */
  | 'invalid-animation'
  /** An asset references a file that is not in the archive. */
  | 'missing-asset'
  /** An asset references an http(s) URL (left as is). */
  | 'external-asset'
  /** The manifest lists a theme or state machine whose file is missing. */
  | 'missing-entry'
  /** A theme or state machine is not valid JSON (kept as a raw file). */
  | 'invalid-entry'
  /** An entry uses an unsupported compression method or is too large (skipped). */
  | 'skipped-entry'
  /** The central directory is damaged; entries were recovered by scanning local headers. */
  | 'salvaged'
  /** An entry's compressed data is damaged (skipped). */
  | 'corrupt-entry'

export interface DotLottieWarning {
  code: DotLottieWarningCode
  /** Archive path or id the warning is about. */
  subject?: string
  /** Technical detail in English (logs, tooltips). */
  detail?: string
}

/** Result of `readDotLottie`. */
export interface DotLottieFile {
  /** Layout that was detected. */
  version: DotLottieVersion
  /** Raw `manifest.json`; null when the archive had none (a plain ZIP). */
  manifest: Record<string, unknown> | null
  /** Animations in manifest order, then any unlisted ones. Never empty. */
  animations: DotLottieAnimation[]
  /** Animation players start with: v2 `initial.animation`, v1 `activeAnimationId`, else the first. */
  activeId: string
  themes: DotLottieJsonEntry[]
  stateMachines: DotLottieJsonEntry[]
  /**
   * Entries not consumed by any animation, theme or state machine, keyed by archive path (for
   * example `i/logo_dark.png`, used only by an Image theme rule). Kept for re-export.
   */
  extraFiles: Record<string, Uint8Array>
  warnings: DotLottieWarning[]
}

export type DotLottieErrorCode =
  /** The bytes are not a ZIP archive. */
  | 'not-zip'
  /** The archive could not be read at all. */
  | 'corrupt'
  /** The archive contains no Lottie animation. */
  | 'no-animation'
  /** Writing v1 was requested but themes or state machines need v2. */
  | 'v2-required'
  /** `writeDotLottie` was called without animations. */
  | 'no-input'

/** Error with a machine-readable code so the UI can show a translated message. */
export class DotLottieError extends Error {
  readonly code: DotLottieErrorCode
  constructor(code: DotLottieErrorCode, message: string) {
    super(message)
    this.name = 'DotLottieError'
    this.code = code
  }
}

/**
 * Everything needed to write a .lottie back after one of its animations was edited. Stored in
 * `DocumentMeta.dotLottie` (opaque to the rest of the app) and passed to `writeDotLottie` as
 * `container`. Structured-cloneable, so it survives autosave.
 */
export interface DotLottieContainer {
  kind: 'dotlottie'
  version: DotLottieVersion
  manifest: Record<string, unknown> | null
  /** Id of the animation being edited: its data is the editor document, not stored here. */
  activeId: string
  /** Every animation in manifest order; `data` is omitted for the active one. */
  animations: { id: string; meta: Record<string, unknown>; data?: Animation }[]
  themes: DotLottieJsonEntry[]
  stateMachines: DotLottieJsonEntry[]
  extraFiles: Record<string, Uint8Array>
}

/** Playback hints written into a v1 manifest (only some players honour them). */
export interface DotLottiePlayback {
  autoplay?: boolean
  loop?: boolean
  speed?: number
  direction?: 1 | -1
  playMode?: 'normal' | 'bounce'
}

export interface WriteDotLottieOptions {
  /** `generator` field of the manifest. */
  generator?: string
  /** Move embedded (data URI) images into the archive. Default true. */
  extractImages?: boolean
  /** Deflate level for JSON entries (media is always stored). Default 9. */
  level?: ZipOptions['level']
  /** Fixed timestamp for reproducible bytes (1980–2099). Default: now. */
  mtime?: Date
  /** v1 manifest playback hints for the active animation (v2 has no such fields). */
  playback?: DotLottiePlayback
}

export interface WriteDotLottieInput {
  /**
   * Animations to write. With a `container`, an animation whose id exists in the container
   * replaces it; a single animation with an unknown id replaces the container's edited (active)
   * animation and keeps its id, so state machines that reference it stay valid.
   */
  animations: { id: string; data: Animation }[]
  /** Animation players start with (default: the container's, else the first). */
  activeId?: string
  /** `DocumentMeta.dotLottie` of a document opened from a .lottie (other values are ignored). */
  container?: unknown
  /** Layout to write. Default: the container's version, or v2 when themes/state machines need it, else v1. */
  version?: DotLottieVersion
  options?: WriteDotLottieOptions
}

/* -------------------------------------------------------------------------- */
/*                               Small utilities                              */
/* -------------------------------------------------------------------------- */

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'application/x-font-ttf': 'ttf',
  'application/font-woff': 'woff',
}

/**
 * Formats that never shrink: stored (level 0) instead of deflated again. Audio is deflated on
 * purpose: real sticker/lottie audio often has silent stretches that compress by a third.
 */
const STORE_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'avif',
  'mp4',
  'webm',
  'woff',
  'woff2',
])

/** Guess the MIME type of media bytes from their magic numbers. */
export function sniffMime(b: Uint8Array): string | undefined {
  const at = (i: number, ...sig: number[]) => sig.every((v, k) => b[i + k] === v)
  const ascii = (i: number, s: string) => at(i, ...Array.from(s, (c) => c.charCodeAt(0)))
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...b.subarray(8, 12))
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand.startsWith('M4A')) return 'audio/mp4'
    return 'video/mp4'
  }
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav'
  if (ascii(0, 'OggS')) return 'audio/ogg'
  if (ascii(0, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm'
  if (ascii(0, 'wOFF')) return 'font/woff'
  if (ascii(0, 'wOF2')) return 'font/woff2'
  if (ascii(0, 'OTTO')) return 'font/otf'
  if (at(0, 0x00, 0x01, 0x00, 0x00) || ascii(0, 'true')) return 'font/ttf'
  const head = strFromU8(b.subarray(0, 1024)).replace(/^﻿/, '').trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')))
    return 'image/svg+xml'
  return undefined
}

/** MIME type for a file name's extension, if it is a known media type. */
export function mimeFromFileName(name: string): string | undefined {
  return EXT_TO_MIME[extOf(name)]
}

function extOf(name: string): string {
  const base = baseName(name)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Base64 of bytes (uses the native encoder when available). */
export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
  }
  return btoa(bin)
}

/** Bytes of a base64 (or base64url) string. Throws on invalid input. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64
  if (typeof native === 'function') return native(clean)
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** `data:` URI for bytes; the MIME type is sniffed, falling back to the name's extension. */
export function toDataUri(bytes: Uint8Array, nameHint = ''): string {
  const mime = sniffMime(bytes) ?? EXT_TO_MIME[extOf(nameHint)] ?? 'application/octet-stream'
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

/** Decodes a `data:` URI (base64 or percent-encoded). Returns null when it is not one or is broken. */
export function parseDataUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  if (!uri.startsWith('data:')) return null
  const comma = uri.indexOf(',')
  if (comma < 0) return null
  const params = uri.slice(5, comma).split(';')
  const payload = uri.slice(comma + 1)
  const mime = (params[0] || 'application/octet-stream').trim().toLowerCase()
  try {
    const bytes = params.some((p) => p.trim().toLowerCase() === 'base64')
      ? base64ToBytes(payload)
      : strToU8(decodeURIComponent(payload))
    return { mime, bytes }
  } catch {
    return null
  }
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  let text = strFromU8(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return JSON.parse(text)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function looksLikeLottieJson(v: unknown): v is Animation {
  return isRecord(v) && Array.isArray(v.layers) && ('w' in v || 'h' in v || 'op' in v || 'fr' in v)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** True when the bytes start with a ZIP local header (or an empty archive's end record). */
export function isZipBytes(b: Uint8Array): boolean {
  return (
    b.length >= 4 &&
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    (b[2] === 0x03 || b[2] === 0x05) &&
    (b[3] === 0x04 || b[3] === 0x06)
  )
}

/** True when every char fits in latin1 and at least one is outside ASCII. */
function isHighLatin1(s: string): boolean {
  let high = false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 0xff) return false
    if (c >= 0x80) high = true
  }
  return high
}

/** fflate decodes names without the UTF-8 flag as latin1: recover the real UTF-8 names. */
function normalizeEntryName(raw: string): string {
  let name = raw
  if (isHighLatin1(name)) {
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(strToU8(name, true))
    } catch {
      // Genuinely latin1 / cp437: keep the name as decoded.
    }
  }
  return cleanRef(name)
}

function cleanRef(s: string): string {
  return s
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
}

const JUNK_RE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i

/* -------------------------------------------------------------------------- */
/*                                    Read                                    */
/* -------------------------------------------------------------------------- */

export interface ReadDotLottieOptions {
  /** Max uncompressed size of one entry (zip-bomb guard). Default 128 MiB. */
  maxEntryBytes?: number
  /** Max total uncompressed size. Default 512 MiB. */
  maxTotalBytes?: number
}

/**
 * Reads a .lottie (or any ZIP holding Lottie JSON, e.g. a Bodymovin export with `images/`).
 * Throws `DotLottieError` when the bytes are not a ZIP or contain no animation; everything
 * recoverable becomes a warning.
 */
export function readDotLottie(bytes: Uint8Array, opts: ReadDotLottieOptions = {}): DotLottieFile {
  if (!isZipBytes(bytes)) throw new DotLottieError('not-zip', 'Not a ZIP archive')
  const warnings: DotLottieWarning[] = []
  const maxEntry = opts.maxEntryBytes ?? 128 * 1024 * 1024
  const maxTotal = opts.maxTotalBytes ?? 512 * 1024 * 1024

  // 1. Unzip with guards. Returning false from the filter skips an entry instead of letting
  //    fflate throw on unsupported methods (only stored and deflate decode).
  let total = 0
  const filter = (f: UnzipFileInfo) => {
    if (!f.name || f.name.endsWith('/') || JUNK_RE.test(f.name)) return false
    if (f.compression !== 0 && f.compression !== 8) {
      warnings.push({
        code: 'skipped-entry',
        subject: f.name,
        detail: `compression method ${f.compression}`,
      })
      return false
    }
    total += f.originalSize
    if (f.originalSize > maxEntry || total > maxTotal) {
      warnings.push({
        code: 'skipped-entry',
        subject: f.name,
        detail: `too large (${f.originalSize} bytes)`,
      })
      return false
    }
    return true
  }
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(bytes, { filter })
    // A damaged central directory can come back as a single nameless entry.
    if (!Object.keys(raw).some(Boolean)) throw new Error('empty central directory')
  } catch (e) {
    warnings.push({ code: 'salvaged', detail: errorMessage(e) })
    total = 0
    raw = salvageLocalEntries(bytes, filter, warnings)
  }
  if (!Object.keys(raw).some(Boolean))
    throw new DotLottieError('corrupt', 'The archive has no readable entries')

  // 2. Normalize names and strip a wrapping folder ("MyAnim/manifest.json" → "manifest.json").
  let entries = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(raw))
    if (name) entries.set(normalizeEntryName(name), data)
  const prefix = detectRootPrefix([...entries.keys()])
  if (prefix) {
    warnings.push({ code: 'nested-folder', subject: prefix.slice(0, -1) })
    const stripped = new Map<string, Uint8Array>()
    for (const [name, data] of entries)
      if (name.startsWith(prefix)) stripped.set(name.slice(prefix.length), data)
    entries = stripped
  }

  // 3. Manifest (tolerant: a broken one is ignored and the archive is scanned instead).
  let manifest: Record<string, unknown> | null = null
  const manifestBytes = entries.get('manifest.json')
  if (manifestBytes) {
    try {
      const m = parseJsonBytes(manifestBytes)
      if (isRecord(m)) manifest = m
      else warnings.push({ code: 'invalid-manifest', detail: 'not an object' })
    } catch (e) {
      warnings.push({ code: 'invalid-manifest', detail: errorMessage(e) })
    }
  } else {
    warnings.push({ code: 'no-manifest' })
  }
  const consumed = new Set<string>(['manifest.json'])

  const names = [...entries.keys()]
  const hasV2Dirs = names.some((n) => /^[aitsfuv]\//.test(n))
  const hasV1Dirs = names.some((n) => n.startsWith('animations/') || n.startsWith('images/'))
  const declared = manifest ? String(manifest.version ?? '').trim() : ''
  const version: DotLottieVersion =
    declared === '2' || declared.startsWith('2.')
      ? 2
      : declared
        ? 1
        : hasV2Dirs && !hasV1Dirs
          ? 2
          : 1

  const animations: DotLottieAnimation[] = []

  // 4. Animations: manifest order first, then any Lottie JSON the manifest forgot.
  const findAnimationEntry = (id: string): string | undefined => {
    for (const c of [
      `a/${id}.json`,
      `animations/${id}.json`,
      `a/${id}.lot`,
      `animations/${id}.lot`,
    ]) {
      if (entries.has(c)) return c
    }
    const want = `${id}.json`.toLowerCase()
    return names.find((n) => baseName(n).toLowerCase() === want)
  }

  const addAnimation = (id: string, path: string, meta: Record<string, unknown>): boolean => {
    // Never carry a broken animation over as an "extra" file.
    if (/^(a|animations)\//.test(path)) consumed.add(path)
    let json: unknown
    try {
      json = parseJsonBytes(entries.get(path)!)
    } catch (e) {
      warnings.push({ code: 'invalid-animation', subject: path, detail: errorMessage(e) })
      return false
    }
    if (!looksLikeLottieJson(json)) {
      warnings.push({ code: 'invalid-animation', subject: path, detail: 'not a Lottie animation' })
      return false
    }
    consumed.add(path)
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    inlineArchiveAssets(json, entries, dir, version, consumed, warnings)
    animations.push({ id, data: json, meta })
    return true
  }

  const manifestAnims = Array.isArray(manifest?.animations)
    ? (manifest.animations as unknown[]).filter(isRecord)
    : []
  for (const meta of manifestAnims) {
    const id = meta.id
    if (typeof id !== 'string' || !id) continue
    const path = findAnimationEntry(id)
    if (!path) {
      warnings.push({ code: 'missing-animation', subject: id })
      continue
    }
    if (consumed.has(path) || animations.some((a) => a.id === id)) continue
    addAnimation(id, path, { ...meta })
  }

  const NON_ANIMATION_DIR = /^(t|s|themes|states|i|images|f|u|v|audio)\//
  const orphans = names
    .filter((n) => /\.(json|lot)$/i.test(n) && !consumed.has(n) && !NON_ANIMATION_DIR.test(n))
    .sort((x, y) => rank(x) - rank(y) || x.localeCompare(y))
  for (const path of orphans) {
    let id = baseName(path).replace(/\.(json|lot)$/i, '')
    if (animations.some((a) => a.id === id))
      id = uniqueId(id, new Set(animations.map((a) => a.id.toLowerCase())))
    const added = addAnimation(id, path, { id })
    if (added && manifest) warnings.push({ code: 'unlisted-animation', subject: path })
  }
  if (!animations.length)
    throw new DotLottieError('no-animation', 'No Lottie animation found in the archive')

  // 5. Active animation: v2 initial.animation → v1 activeAnimationId → first.
  const initial = isRecord(manifest?.initial) ? manifest.initial : undefined
  const wanted = [initial?.animation, manifest?.activeAnimationId].find(
    (v): v is string => typeof v === 'string',
  )
  const activeId = wanted && animations.some((a) => a.id === wanted) ? wanted : animations[0].id

  // 6. Themes and state machines (v2 `t/`, `s/`; legacy dotlottie-js 0.x `themes/`, `states/`).
  const readEntries = (list: unknown, dirs: string[], exts: string[]): DotLottieJsonEntry[] => {
    const out: DotLottieJsonEntry[] = []
    for (const item of Array.isArray(list) ? list : []) {
      const id =
        typeof item === 'string'
          ? item
          : isRecord(item) && typeof item.id === 'string'
            ? item.id
            : undefined
      if (!id) continue
      const path = dirs.flatMap((d) => exts.map((x) => `${d}${id}${x}`)).find((p) => entries.has(p))
      if (!path) {
        warnings.push({ code: 'missing-entry', subject: id })
        continue
      }
      try {
        const data = parseJsonBytes(entries.get(path)!)
        const name = isRecord(item) && typeof item.name === 'string' ? item.name : undefined
        out.push(name ? { id, name, data } : { id, data })
        consumed.add(path)
      } catch (e) {
        warnings.push({ code: 'invalid-entry', subject: path, detail: errorMessage(e) })
      }
    }
    return out
  }
  const themes = readEntries(manifest?.themes, ['t/', 'themes/'], ['.json', '.lss'])
  const stateMachines = readEntries(
    manifest?.stateMachines ?? manifest?.states,
    ['s/', 'states/'],
    ['.json'],
  )

  // 7. Everything else survives as an opaque file (theme images, fonts, audio…).
  const extraFiles: Record<string, Uint8Array> = {}
  for (const [name, data] of entries) if (!consumed.has(name)) extraFiles[name] = data

  return { version, manifest, animations, activeId, themes, stateMachines, extraFiles, warnings }
}

/** Streaming local-header scan (ignores the central directory), like Java's ZipInputStream. */
function salvageLocalEntries(
  bytes: Uint8Array,
  filter: (f: UnzipFileInfo) => boolean,
  warnings: DotLottieWarning[],
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  const unzipper = new Unzip((file) => {
    const info = {
      name: file.name,
      size: file.size ?? 0,
      originalSize: file.originalSize ?? 0,
      compression: file.compression,
    }
    if (!filter(info)) return
    const chunks: Uint8Array[] = []
    file.ondata = (err, chunk, final) => {
      if (err) {
        warnings.push({ code: 'corrupt-entry', subject: file.name, detail: err.message })
        return
      }
      chunks.push(chunk)
      if (final) {
        const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
        let offset = 0
        for (const c of chunks) {
          joined.set(c, offset)
          offset += c.length
        }
        out[file.name] = joined
      }
    }
    try {
      file.start()
    } catch (e) {
      warnings.push({ code: 'corrupt-entry', subject: file.name, detail: errorMessage(e) })
    }
  })
  unzipper.register(UnzipInflate)
  try {
    unzipper.push(bytes, true)
  } catch (e) {
    warnings.push({
      code: 'corrupt-entry',
      detail: `local-header scan stopped early: ${errorMessage(e)}`,
    })
  }
  return out
}

function rank(path: string): number {
  if (path.startsWith('a/')) return 0
  if (path.startsWith('animations/')) return 1
  return path.includes('/') ? 3 : 2
}

function detectRootPrefix(names: string[]): string {
  if (names.includes('manifest.json')) return ''
  const nested = names
    .filter((n) => n.endsWith('/manifest.json'))
    .sort((a, b) => a.split('/').length - b.split('/').length)
  if (nested.length) return nested[0].slice(0, -'manifest.json'.length)
  const tops = new Set(names.map((n) => (n.includes('/') ? n.slice(0, n.indexOf('/') + 1) : '')))
  if (tops.size === 1) {
    const [top] = [...tops]
    if (top && !/^(a|i|t|s|f|u|v|animations|images|audio|themes|states)\/$/.test(top)) return top
  }
  return ''
}

/**
 * Replaces archive references in `assets[].p` and `fonts.list[].fPath` with data URIs.
 * Probe order mirrors dotlottie-rs (exact key → conventional folder + key → folder + basename),
 * plus the JSON's own folder and, last, a unique case-insensitive basename anywhere.
 */
function inlineArchiveAssets(
  data: Animation,
  entries: Map<string, Uint8Array>,
  animationDir: string,
  version: DotLottieVersion,
  consumed: Set<string>,
  warnings: DotLottieWarning[],
): void {
  const folders = version === 2 ? ['i/', 'u/', 'v/', 'f/', 'images/'] : ['images/', 'audio/', 'i/']
  const names = [...entries.keys()]
  const resolve = (u: string, p: string): string | undefined => {
    let rel = p
    try {
      rel = decodeURIComponent(p)
    } catch {
      // keep the raw reference
    }
    const joined = cleanRef(`${u}${rel}`)
    const clean = cleanRef(rel)
    const base = baseName(clean)
    const candidates = [
      joined,
      clean,
      animationDir + joined,
      animationDir + clean,
      ...folders.map((f) => f + clean),
      ...folders.map((f) => f + base),
    ]
    for (const c of candidates) if (entries.has(c)) return c
    const lower = base.toLowerCase()
    const hits = names.filter((n) => baseName(n).toLowerCase() === lower)
    return hits.length === 1 ? hits[0] : undefined
  }

  for (const asset of (data.assets ?? []) as unknown[]) {
    if (!isRecord(asset) || Array.isArray(asset.layers) || typeof asset.p !== 'string' || !asset.p)
      continue
    const p = asset.p
    if (p.startsWith('data:')) {
      // lottie-web only treats `p` as a URL/data URI when `e` is truthy.
      asset.e = 1
      asset.u = ''
      continue
    }
    if (/^(https?:|blob:)/i.test(p)) {
      warnings.push({ code: 'external-asset', subject: String(asset.id ?? ''), detail: p })
      continue
    }
    const u = typeof asset.u === 'string' ? asset.u : ''
    const hit = resolve(u, p)
    if (!hit) {
      warnings.push({ code: 'missing-asset', subject: String(asset.id ?? ''), detail: `${u}${p}` })
      continue
    }
    consumed.add(hit)
    asset.p = toDataUri(entries.get(hit)!, hit)
    asset.u = ''
    asset.e = 1
  }

  const fonts =
    isRecord(data.fonts) && Array.isArray(data.fonts.list) ? (data.fonts.list as unknown[]) : []
  for (const font of fonts) {
    if (!isRecord(font) || typeof font.fPath !== 'string' || !font.fPath) continue
    if (font.fPath.startsWith('data:') || /^(https?:|blob:)/i.test(font.fPath)) continue
    const hit = resolve('', font.fPath)
    // A system/CSS font or a genuinely missing file: leave it untouched.
    if (!hit) continue
    consumed.add(hit)
    // lottie-web (origin 3) injects `@font-face { src: url(<fPath>) }`, so a data URI works.
    font.fPath = toDataUri(entries.get(hit)!, hit)
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Container                                 */
/* -------------------------------------------------------------------------- */

/**
 * Builds the opaque container kept in the document meta when `editedId` is opened for editing.
 * The edited animation's data is left out (the editor document replaces it on save).
 */
export function createDotLottieContainer(
  file: DotLottieFile,
  editedId: string = file.activeId,
): DotLottieContainer {
  const activeId = file.animations.some((a) => a.id === editedId) ? editedId : file.activeId
  return {
    kind: 'dotlottie',
    version: file.version,
    manifest: file.manifest,
    activeId,
    animations: file.animations.map((a) =>
      a.id === activeId ? { id: a.id, meta: a.meta } : { id: a.id, meta: a.meta, data: a.data },
    ),
    themes: file.themes,
    stateMachines: file.stateMachines,
    extraFiles: file.extraFiles,
  }
}

/** Type guard for containers created by `createDotLottieContainer`. */
export function isDotLottieContainer(value: unknown): value is DotLottieContainer {
  return (
    isRecord(value) &&
    value.kind === 'dotlottie' &&
    (value.version === 1 || value.version === 2) &&
    typeof value.activeId === 'string' &&
    Array.isArray(value.animations) &&
    Array.isArray(value.themes) &&
    Array.isArray(value.stateMachines) &&
    isRecord(value.extraFiles)
  )
}

/**
 * Switches the edited animation of a container: stores `currentDoc` as the data of the animation
 * being edited and returns the data of `nextId` (to load into the editor) with the new container.
 * Returns null when `nextId` is unknown or has no data.
 */
export function switchContainerAnimation(
  container: DotLottieContainer,
  currentDoc: Animation,
  nextId: string,
): { container: DotLottieContainer; data: Animation } | null {
  const next = container.animations.find((a) => a.id === nextId)
  if (!next) return null
  if (nextId === container.activeId) return null
  if (!next.data) return null
  const data = next.data
  return {
    data,
    container: {
      ...container,
      activeId: nextId,
      animations: container.animations.map((a) => {
        if (a.id === container.activeId) return { id: a.id, meta: a.meta, data: currentDoc }
        if (a.id === nextId) return { id: a.id, meta: a.meta }
        return a
      }),
    },
  }
}

/** Number of animations a container holds (1 for anything that is not a container). */
export function containerAnimationCount(value: unknown): number {
  return isDotLottieContainer(value) ? value.animations.length : 1
}

/** True when writing `value` (a container) as dotLottie v1 would drop themes or state machines. */
export function needsDotLottieV2(value: unknown): boolean {
  if (!isDotLottieContainer(value)) return false
  return (
    value.themes.length > 0 || value.stateMachines.length > 0 || hasV2OnlyFiles(value.extraFiles)
  )
}

function hasV2OnlyFiles(files: Record<string, Uint8Array>): boolean {
  return Object.keys(files).some((k) => /^[tsfuv]\//.test(k))
}

/* -------------------------------------------------------------------------- */
/*                                    Write                                   */
/* -------------------------------------------------------------------------- */

/** dotLottie v2 manifest id pattern (spaces are legal; ids never start with a dot here). */
const ID_OK = /^[a-zA-Z0-9_ -][a-zA-Z0-9._ -]*$/

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
}

function transliterate(s: string): string {
  return s.replace(/[Ѐ-ӿ]/g, (ch) => {
    const lower = ch.toLowerCase()
    const t = TRANSLIT[lower]
    if (t === undefined) return ch
    return ch === lower || !t ? t : t[0].toUpperCase() + t.slice(1)
  })
}

function uniqueId(id: string, usedLower: Set<string>): string {
  let candidate = id
  for (let n = 2; usedLower.has(candidate.toLowerCase()); n++) candidate = `${id}_${n}`
  return candidate
}

/**
 * Makes a safe, unique (case-insensitively, for case-insensitive file systems) archive id.
 * Legal ids are kept as they are, so ids referenced by state machines survive a round trip;
 * anything else is transliterated and reduced to `[A-Za-z0-9._-]`.
 */
export function sanitizeDotLottieId(
  raw: string,
  used: Set<string>,
  fallback = 'animation',
): string {
  let id = raw.trim()
  if (!ID_OK.test(id) || id.length > 120) {
    id = transliterate(id)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._]+|[._]+$/g, '')
      .slice(0, 80)
  }
  if (!id || !ID_OK.test(id)) id = fallback
  const unique = uniqueId(id, used)
  used.add(unique.toLowerCase())
  return unique
}

/** cyrb53: tiny synchronous hash for content de-duplication (collisions are re-checked). */
export function hashBytes(b: Uint8Array): string {
  let h1 = 0xdeadbeef ^ b.length
  let h2 = 0x41c6ce57 ^ b.length
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 2654435761)
    h2 = Math.imul(h2 ^ b[i], 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

interface ResolvedAnimation {
  /** Id to write (sanitized, unique). */
  id: string
  /** Id before sanitizing (as referenced by the container / state machines). */
  sourceId: string
  data: Animation
  meta: Record<string, unknown>
}

/** Merges the input animations with the container's (see WriteDotLottieInput.animations). */
function resolveAnimations(
  input: WriteDotLottieInput,
  container: DotLottieContainer | null,
): {
  list: Omit<ResolvedAnimation, 'id'>[]
  activeSourceId: string
} {
  const inputs = input.animations
  if (!container) {
    const list = inputs.map((a) => ({
      sourceId: a.id,
      data: a.data,
      meta: {} as Record<string, unknown>,
    }))
    const activeSourceId =
      input.activeId && inputs.some((a) => a.id === input.activeId) ? input.activeId : inputs[0].id
    return { list, activeSourceId }
  }

  const containerIds = new Set(container.animations.map((a) => a.id))
  const unmatched = inputs.filter((a) => !containerIds.has(a.id))
  // A single animation with an unknown id is the edited one: it replaces the container's active
  // animation and keeps its id.
  const replacement =
    unmatched.length === 1 && !inputs.some((a) => a.id === container.activeId) ? unmatched[0] : null
  const used = new Set<{ id: string; data: Animation }>()

  const list: Omit<ResolvedAnimation, 'id'>[] = []
  for (const entry of container.animations) {
    const direct = inputs.find((a) => a.id === entry.id)
    const source = direct ?? (entry.id === container.activeId && replacement ? replacement : null)
    if (source) {
      used.add(source)
      list.push({ sourceId: entry.id, data: source.data, meta: entry.meta })
    } else if (entry.data) {
      list.push({ sourceId: entry.id, data: entry.data, meta: entry.meta })
    }
    // An edited animation without new data cannot be written: it is dropped (nothing to save).
  }
  for (const a of inputs) {
    if (!used.has(a)) list.push({ sourceId: a.id, data: a.data, meta: {} })
  }

  let activeSourceId = container.activeId
  if (input.activeId) {
    if (list.some((a) => a.sourceId === input.activeId)) activeSourceId = input.activeId
    else if (replacement && input.activeId === replacement.id) activeSourceId = container.activeId
  }
  if (!list.some((a) => a.sourceId === activeSourceId)) activeSourceId = list[0]?.sourceId ?? ''
  return { list, activeSourceId }
}

/** Rewrites `animation` references in state machine JSON after an id changed. */
function renameAnimationRefs(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) return value.map((v) => renameAnimationRefs(v, from, to))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] =
      (k === 'animation' || k === 'animationId') && v === from
        ? to
        : renameAnimationRefs(v, from, to)
  }
  return out
}

function v1Playback(
  meta: Record<string, unknown>,
  override?: DotLottiePlayback,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const src: Record<string, unknown> = { ...meta, ...override }
  if (typeof src.autoplay === 'boolean') out.autoplay = src.autoplay
  // Boolean only: numeric loop counts are legal in the spec but make lottie-ios reject the manifest.
  if (typeof src.loop === 'boolean') out.loop = src.loop
  else if (typeof src.loop === 'number') out.loop = src.loop !== 0
  if (typeof src.speed === 'number' && Number.isFinite(src.speed) && src.speed > 0)
    out.speed = src.speed
  if (src.direction === 1 || src.direction === -1) out.direction = src.direction
  const mode = src.playMode ?? src.mode
  if (mode === 'normal' || mode === 'bounce') out.playMode = mode
  if (typeof src.hover === 'boolean') out.hover = src.hover
  if (
    typeof src.intermission === 'number' &&
    Number.isFinite(src.intermission) &&
    src.intermission >= 0
  ) {
    out.intermission = src.intermission
  }
  if (typeof src.themeColor === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(src.themeColor)) {
    out.themeColor = src.themeColor
  }
  return out
}

/** v1 ⇄ v2 folder remap for carried-over files (images/ ⇄ i/). */
function remapExtraFiles(
  files: Record<string, Uint8Array>,
  version: DotLottieVersion,
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const [path, bytes] of Object.entries(files)) {
    let p = path
    if (version === 2 && p.startsWith('images/')) p = `i/${p.slice('images/'.length)}`
    if (version === 1 && p.startsWith('i/')) p = `images/${p.slice(2)}`
    out[p] = bytes
  }
  return out
}

/**
 * Writes a .lottie archive. With `container` (the `meta.dotLottie` of a document opened from a
 * .lottie), other animations, themes, state machines, extra files and manifest metadata are
 * preserved. Throws `DotLottieError` ('no-input', 'v2-required').
 */
export function writeDotLottie(input: WriteDotLottieInput): Uint8Array<ArrayBuffer> {
  if (!input.animations.length)
    throw new DotLottieError('no-input', 'writeDotLottie: at least one animation is required')
  const container = isDotLottieContainer(input.container) ? input.container : null
  const opts = input.options ?? {}
  const themes = container?.themes ?? []
  const stateMachines = container?.stateMachines ?? []
  const extraSource = container?.extraFiles ?? {}
  const needsV2 = themes.length > 0 || stateMachines.length > 0 || hasV2OnlyFiles(extraSource)
  const version: DotLottieVersion = input.version ?? (needsV2 ? 2 : (container?.version ?? 1))
  if (version === 1 && needsV2) {
    throw new DotLottieError('v2-required', 'Themes and state machines require dotLottie v2')
  }
  const extra = remapExtraFiles(extraSource, version)

  // Ids: sanitize and de-duplicate; the active animation goes first (lottie-ios and dotlottie-rs
  // v1 play the first one).
  const { list, activeSourceId } = resolveAnimations(input, container)
  const usedIds = new Set<string>()
  const anims: ResolvedAnimation[] = list.map((a) => ({
    ...a,
    id: sanitizeDotLottieId(a.sourceId, usedIds),
  }))
  const activeIndex = Math.max(
    0,
    anims.findIndex((a) => a.sourceId === activeSourceId),
  )
  anims.unshift(...anims.splice(activeIndex, 1))
  const active = anims[0]

  // Keep state machine references valid when an id had to change.
  let smDocs = stateMachines
  for (const a of anims) {
    if (a.id !== a.sourceId)
      smDocs = smDocs.map((s) => ({ ...s, data: renameAnimationRefs(s.data, a.sourceId, a.id) }))
  }

  const level = opts.level ?? 9
  const base: ZipOptions = opts.mtime ? { mtime: opts.mtime } : {}
  const jsonOpts: ZipOptions = { ...base, level }
  const fileOpts = (name: string): ZipOptions => ({
    ...base,
    level: STORE_EXT.has(extOf(name)) ? 0 : level,
  })

  // Media: content-addressed de-duplication across all animations.
  const imgDir = version === 2 ? 'i/' : 'images/'
  const media = new Map<string, Uint8Array>()
  const byHash = new Map<string, string[]>()
  const usedNames = new Set<string>(Object.keys(extra).map((k) => k.toLowerCase()))
  const putMedia = (dir: string, stem: string, bytes: Uint8Array, mime: string): string => {
    const h = hashBytes(bytes)
    for (const path of byHash.get(h) ?? []) {
      if (path.startsWith(dir) && sameBytes(media.get(path)!, bytes)) return baseName(path)
    }
    const ext = MIME_TO_EXT[mime] ?? MIME_TO_EXT[sniffMime(bytes) ?? ''] ?? 'bin'
    // No spaces and no leading dot: lottie-ios skips hidden files in i/.
    const cleanStem = sanitizeDotLottieId(stem.replace(/\s+/g, '_'), new Set(), 'asset')
    let name = `${cleanStem}.${ext}`
    for (let n = 2; usedNames.has(`${dir}${name}`.toLowerCase()); n++)
      name = `${cleanStem}_${n}.${ext}`
    usedNames.add(`${dir}${name}`.toLowerCase())
    media.set(dir + name, bytes)
    byHash.set(h, [...(byHash.get(h) ?? []), dir + name])
    return name
  }

  const animJson = new Map<string, Uint8Array>()
  for (const anim of anims) {
    const data = JSON.parse(JSON.stringify(anim.data)) as Animation & Record<string, unknown>
    if (opts.extractImages !== false) extractMedia(data, version, imgDir, putMedia)
    animJson.set(anim.id, strToU8(JSON.stringify(data)))
  }

  const manifest = buildManifest({
    version,
    generator: opts.generator ?? 'Lottie Editor',
    source: container?.manifest ?? null,
    anims,
    activeId: active.id,
    playback: opts.playback,
    themes,
    stateMachines: smDocs,
  })

  // Entry order matters only for naive readers: lottie-android parses every *.json and keeps the
  // LAST one; lottie-flutter picks the first animation JSON. So: manifest, themes, state machines,
  // media, other animations, active animation last.
  const files: Zippable = {}
  files['manifest.json'] = [strToU8(JSON.stringify(manifest)), jsonOpts]
  if (version === 2) {
    for (const t of themes) files[`t/${t.id}.json`] = [strToU8(JSON.stringify(t.data)), jsonOpts]
    for (const s of smDocs) files[`s/${s.id}.json`] = [strToU8(JSON.stringify(s.data)), jsonOpts]
  }
  for (const [path, bytes] of media) files[path] = [bytes, fileOpts(path)]
  for (const [path, bytes] of Object.entries(extra))
    if (!(path in files)) files[path] = [bytes, fileOpts(path)]
  const animDir = version === 2 ? 'a/' : 'animations/'
  for (const a of [...anims.slice(1), active])
    files[`${animDir}${a.id}.json`] = [animJson.get(a.id)!, jsonOpts]
  return zipSync(files)
}

/** Moves embedded images (and, in v2, audio and fonts) into archive files. Mutates `data`. */
function extractMedia(
  data: Animation & Record<string, unknown>,
  version: DotLottieVersion,
  imgDir: string,
  putMedia: (dir: string, stem: string, bytes: Uint8Array, mime: string) => string,
): void {
  // Damaged files may hold anything here: only a list of assets can have media to move.
  if (!isRecord(data)) return
  const assets: unknown[] = Array.isArray(data.assets) ? data.assets : []
  for (const asset of assets) {
    if (!isRecord(asset) || Array.isArray(asset.layers) || typeof asset.p !== 'string') continue
    const parsed = parseDataUri(asset.p)
    // External URL or already a file reference: leave it untouched.
    if (!parsed) continue
    const mime = sniffMime(parsed.bytes) ?? parsed.mime
    if (mime.startsWith('video/')) {
      // Video is experimental everywhere: v2 players that support it read `v/` (dotlottie-js,
      // dotlottie-rs); v1 keeps it inline.
      if (version === 2) {
        asset.p = putMedia('v/', String(asset.id ?? 'video'), parsed.bytes, mime)
        asset.u = '/v/'
        asset.e = 0
      }
      continue
    }
    const isImage = 'w' in asset || 'h' in asset || mime.startsWith('image/')
    if (isImage && mime.startsWith('image/')) {
      asset.p = putMedia(imgDir, String(asset.id ?? 'image'), parsed.bytes, mime)
      // "/i/" or "/images/": the dotlottie-js convention every player resolves.
      asset.u = `/${imgDir}`
      asset.e = 0
    } else if (!isImage && mime.startsWith('audio/') && version === 2) {
      asset.p = putMedia('u/', String(asset.id ?? 'audio'), parsed.bytes, mime)
      asset.u = '/u/'
      asset.e = 0
    }
  }
  if (version !== 2 || !isRecord(data.fonts) || !Array.isArray(data.fonts.list)) return
  for (const font of data.fonts.list as unknown[]) {
    if (!isRecord(font) || typeof font.fPath !== 'string') continue
    const parsed = parseDataUri(font.fPath)
    if (!parsed) continue
    const mime = sniffMime(parsed.bytes) ?? parsed.mime
    if (!mime.includes('font')) continue
    font.fPath = `/f/${putMedia('f/', String(font.fName ?? 'font'), parsed.bytes, mime)}`
    font.origin = 3
  }
}

interface ManifestInput {
  version: DotLottieVersion
  generator: string
  source: Record<string, unknown> | null
  anims: ResolvedAnimation[]
  activeId: string
  playback?: DotLottiePlayback
  themes: DotLottieJsonEntry[]
  stateMachines: DotLottieJsonEntry[]
}

function buildManifest(m: ManifestInput): Record<string, unknown> {
  const src = m.source ?? {}
  if (m.version === 1) {
    return {
      version: '1',
      generator: m.generator,
      ...(typeof src.author === 'string' ? { author: src.author } : {}),
      ...(typeof src.description === 'string' ? { description: src.description } : {}),
      ...(typeof src.keywords === 'string' ? { keywords: src.keywords } : {}),
      ...(typeof src.revision === 'number' ? { revision: src.revision } : {}),
      ...(m.anims.length > 1 ? { activeAnimationId: m.activeId } : {}),
      animations: m.anims.map((a) => ({
        id: a.id,
        ...v1Playback(a.meta, a.id === m.activeId ? m.playback : undefined),
      })),
      ...(isRecord(src.custom) && Object.keys(src.custom).length ? { custom: src.custom } : {}),
    }
  }
  const themeIds = new Set(m.themes.map((t) => t.id))
  const smIds = new Set(m.stateMachines.map((s) => s.id))
  const initial = isRecord(src.initial) ? src.initial : {}
  const initialSm =
    typeof initial.stateMachine === 'string' && smIds.has(initial.stateMachine)
      ? initial.stateMachine
      : undefined
  return {
    version: '2',
    generator: m.generator,
    animations: m.anims.map((a) => {
      const themes = Array.isArray(a.meta.themes)
        ? a.meta.themes.filter((t): t is string => typeof t === 'string' && themeIds.has(t))
        : []
      return {
        id: a.id,
        ...(typeof a.meta.initialTheme === 'string' && themeIds.has(a.meta.initialTheme)
          ? { initialTheme: a.meta.initialTheme }
          : {}),
        ...(themes.length ? { themes } : {}),
        // Only string backgrounds survive: the spec's u32 integer makes dotlottie-web reject the file.
        ...(typeof a.meta.background === 'string' ? { background: a.meta.background } : {}),
      }
    }),
    ...(m.themes.length
      ? { themes: m.themes.map((t) => ({ id: t.id, ...(t.name ? { name: t.name } : {}) })) }
      : {}),
    ...(m.stateMachines.length
      ? {
          stateMachines: m.stateMachines.map((s) => ({
            id: s.id,
            ...(s.name ? { name: s.name } : {}),
          })),
        }
      : {}),
    ...(m.anims.length > 1 || initialSm
      ? { initial: { animation: m.activeId, ...(initialSm ? { stateMachine: initialSm } : {}) } }
      : {}),
  }
}
