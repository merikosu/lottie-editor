/**
 * Opening Lottie files in every format the editor accepts:
 *  - Bodymovin JSON (`.json`, `.lot`), also inside API wrappers (`{ "animationData": {…} }`),
 *    as a list of animations, or as a JavaScript snippet (`export default {…}`)
 *  - dotLottie (`.lottie` v1 and v2), possibly with several animations
 *  - Telegram stickers (`.tgs`: gzipped Lottie JSON)
 *  - ZIP exports (`data.json` + `images/`): images are embedded as data URIs
 *
 * Pure domain logic (no DOM, no React). Failures throw `LottieFileError` with a code the UI
 * translates; recoverable problems are returned as coded warnings.
 */
import { gunzipSync, gzipSync, strToU8 } from 'fflate'
import { fromObject, looksLikeLottie } from './document'
import {
  DotLottieError,
  isZipBytes,
  mimeFromFileName,
  readDotLottie,
  sniffMime,
  toDataUri,
  type DotLottieFile,
  type DotLottieWarningCode,
} from './dotlottie'
import type { Animation } from './types'
import { isImageAsset } from './types'

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

export type FileKind = 'json' | 'dotlottie' | 'tgs' | 'zip' | 'unknown'

export type LottieFileErrorCode =
  /** The file (or the JSON inside it) is empty. */
  | 'empty'
  /** Not valid JSON; `line`/`column`/`found` locate the problem. */
  | 'invalid-json'
  /** Valid JSON that is not a Lottie animation; `hint` says what it looks like instead. */
  | 'not-lottie'
  /** A ZIP / .lottie archive that cannot be read. */
  | 'corrupt-zip'
  /** An archive without any Lottie animation. */
  | 'no-animation'
  /** A .tgs (gzip) file that cannot be decompressed. */
  | 'corrupt-gzip'
  /** A web page (HTML) instead of a Lottie file, typically from a URL. */
  | 'html'
  /** An image file (images are added to an open animation, not opened). */
  | 'image'
  /** Anything else. `detail` holds the extension. */
  | 'unsupported'

/** What a non-Lottie JSON seems to be, for a more helpful message. */
export type NotLottieHint = 'dotlottie-manifest' | 'theme' | 'state-machine' | 'partial'

/** Error with a machine-readable code so the UI can show a translated message. */
export class LottieFileError extends Error {
  readonly code: LottieFileErrorCode
  /** 1-based position of a JSON syntax error. */
  readonly line?: number
  readonly column?: number
  /** Unexpected character of a JSON syntax error; null means the file ended too early. */
  readonly found?: string | null
  readonly hint?: NotLottieHint
  /** Extra detail (file extension for 'unsupported'/'image'). */
  readonly detail?: string

  constructor(
    code: LottieFileErrorCode,
    message: string,
    extra: {
      line?: number
      column?: number
      found?: string | null
      hint?: NotLottieHint
      detail?: string
    } = {},
  ) {
    super(message)
    this.name = 'LottieFileError'
    this.code = code
    this.line = extra.line
    this.column = extra.column
    this.found = extra.found
    this.hint = extra.hint
    this.detail = extra.detail
  }
}

export type OpenWarningCode =
  | DotLottieWarningCode
  /** The animation was found inside a wrapper object; `subject` is the key path. */
  | 'unwrapped'
  /** The file was a JavaScript snippet around the JSON. */
  | 'js-snippet'
  /** Image assets reference files outside the document; `count` and `subject` (first names). */
  | 'external-images'

export interface OpenWarning {
  code: OpenWarningCode
  subject?: string
  detail?: string
  count?: number
}

/** One animation found in an opened file. */
export interface OpenedAnimation {
  /** Stable id (dotLottie manifest id, otherwise derived from the file name). */
  id: string
  /** Display name: manifest name, the animation's `nm`, or the id. */
  name: string
  data: Animation
  /** Automatic repairs made while loading (English sentences from normalizeAnimation). */
  repairs: string[]
}

export interface OpenResult {
  kind: Exclude<FileKind, 'unknown'>
  fileName: string
  /** Size of the source file in bytes. */
  size: number
  /** Never empty. Several entries: let the user pick one. */
  animations: OpenedAnimation[]
  /** Animation to open by default. */
  activeId: string
  /** The parsed archive, for dotLottie files (build the document container from it). */
  dotLottie?: DotLottieFile
  warnings: OpenWarning[]
}

/** A file supplied next to the animation (e.g. images of a Bodymovin export folder). */
export interface NamedBytes {
  /** File name (`img_0.png`). */
  name: string
  /** Relative path when known (`images/img_0.png`, from a dropped folder). */
  path?: string
  bytes: Uint8Array
}

export interface ReadLottieOptions {
  /** Images dropped or picked together with the animation, used to embed external references. */
  images?: NamedBytes[]
}

/* -------------------------------------------------------------------------- */
/*                                File names                                  */
/* -------------------------------------------------------------------------- */

/** Extensions the editor opens as animations. */
export const LOTTIE_EXTENSIONS = ['json', 'lottie', 'tgs', 'zip', 'lot'] as const

/** `accept` attribute for the Open dialog. */
export const OPEN_ACCEPT = '.json,.lottie,.tgs,.zip,.lot,application/json,application/zip'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp'])

/** Lower-case extension without the dot ('' when there is none). */
export function fileExtension(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** File name without folders and extension ('animation' when nothing is left). */
export function fileStem(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim()
  return stem || 'animation'
}

/** True for names/MIME types of files the editor opens as animations. */
export function isLottieFileName(name: string, type = ''): boolean {
  return (
    (LOTTIE_EXTENSIONS as readonly string[]).includes(fileExtension(name)) ||
    type === 'application/json' ||
    type === 'application/zip' ||
    type === 'application/x-zip-compressed'
  )
}

/** True for image files (by MIME type or extension). */
export function isImageFileName(name: string, type = ''): boolean {
  return type.startsWith('image/') || IMAGE_EXTENSIONS.has(fileExtension(name))
}

/* -------------------------------------------------------------------------- */
/*                                  Sniffing                                  */
/* -------------------------------------------------------------------------- */

const JS_PREFIX =
  /^(?:export\s+default\s+|module\.exports\s*=\s*|(?:export\s+)?(?:var|let|const)\s+[\w$]+(?:\s*:\s*[\w$.<>[\]]+)?\s*=\s*|(?:window|globalThis|self)\.[\w$]+\s*=\s*)/

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function textHead(bytes: Uint8Array): string {
  return decodeText(bytes.subarray(0, 512)).trimStart()
}

function isGzipBytes(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b
}

/** Finds an ASCII needle in bytes (entry names are stored uncompressed in ZIP headers). */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const n = needle.length
  const first = needle.charCodeAt(0)
  outer: for (let i = 0; i <= bytes.length - n; i++) {
    if (bytes[i] !== first) continue
    for (let k = 1; k < n; k++) if (bytes[i + k] !== needle.charCodeAt(k)) continue outer
    return true
  }
  return false
}

/**
 * Detects the format from magic bytes (ZIP `PK\x03\x04`, gzip `1f 8b`, JSON `{`/`[` after a BOM
 * and whitespace); the file name only breaks ties (ZIP → dotLottie vs plain ZIP export).
 */
export function sniffFormat(bytes: Uint8Array, fileName = ''): FileKind {
  const ext = fileExtension(fileName)
  if (isZipBytes(bytes)) {
    if (ext === 'lottie') return 'dotlottie'
    if (ext === 'zip') return 'zip'
    return containsAscii(bytes, 'manifest.json') ? 'dotlottie' : 'zip'
  }
  if (isGzipBytes(bytes)) return 'tgs'
  const head = textHead(bytes)
  if (head.startsWith('{') || head.startsWith('[') || JS_PREFIX.test(head)) return 'json'
  // Let the JSON parser say where a broken .json file goes wrong.
  if ((ext === 'json' || ext === 'lot') && head && !head.startsWith('<')) return 'json'
  return 'unknown'
}

/* -------------------------------------------------------------------------- */
/*                                    JSON                                    */
/* -------------------------------------------------------------------------- */

export interface JsonErrorLocation {
  /** 0-based character offset. */
  offset: number
  /** 1-based line and column. */
  line: number
  column: number
  /** The unexpected character; null when the text ended too early. */
  found: string | null
}

/**
 * Finds where text stops being valid JSON (engines differ in what their error messages say, so
 * the position is computed here). Returns null for valid JSON.
 */
export function locateJsonError(text: string): JsonErrorLocation | null {
  const n = text.length
  let i = 0
  const skipWs = () => {
    while (i < n) {
      const c = text.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else break
    }
  }
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const HEX = /^[0-9a-fA-F]{4}$/

  const parseString = (): boolean => {
    i++ // opening quote
    while (i < n) {
      const c = text.charCodeAt(i)
      if (c === 34) {
        i++
        return true
      }
      if (c === 92) {
        const esc = text[i + 1]
        if (esc === undefined) {
          i++
          return false
        }
        if ('"\\/bfnrt'.includes(esc)) i += 2
        else if (esc === 'u' && HEX.test(text.slice(i + 2, i + 6))) i += 6
        else {
          i++
          return false
        }
      } else if (c < 0x20) {
        return false
      } else {
        i++
      }
    }
    return false
  }

  const parseLiteral = (word: string): boolean => {
    for (let k = 0; k < word.length; k++) {
      if (text[i] !== word[k]) return false
      i++
    }
    return true
  }

  const parseValue = (depth: number): boolean => {
    if (depth > 4000) return false
    skipWs()
    if (i >= n) return false
    const c = text[i]
    if (c === '{') {
      i++
      skipWs()
      if (text[i] === '}') {
        i++
        return true
      }
      for (;;) {
        skipWs()
        if (text[i] !== '"' || !parseString()) return false
        skipWs()
        if (text[i] !== ':') return false
        i++
        if (!parseValue(depth + 1)) return false
        skipWs()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return true
        }
        return false
      }
    }
    if (c === '[') {
      i++
      skipWs()
      if (text[i] === ']') {
        i++
        return true
      }
      for (;;) {
        if (!parseValue(depth + 1)) return false
        skipWs()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return true
        }
        return false
      }
    }
    if (c === '"') return parseString()
    if (c === 't') return parseLiteral('true')
    if (c === 'f') return parseLiteral('false')
    if (c === 'n') return parseLiteral('null')
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(text)
      if (!m) {
        if (c === '-') i++
        return false
      }
      i += m[0].length
      return true
    }
    return false
  }

  let ok = parseValue(0)
  if (ok) {
    skipWs()
    ok = i >= n
  }
  if (ok) return null
  const offset = Math.min(i, n)
  let line = 1
  let lineStart = 0
  for (let k = 0; k < offset; k++) {
    if (text.charCodeAt(k) === 10) {
      line++
      lineStart = k + 1
    }
  }
  return { offset, line, column: offset - lineStart + 1, found: offset < n ? text[offset] : null }
}

/**
 * Parses JSON text; also accepts a JavaScript snippet around it (`export default {…};`).
 * Throws LottieFileError ('empty', 'invalid-json' with the error position).
 */
export function parseJsonText(text: string, warnings?: OpenWarning[]): unknown {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) throw new LottieFileError('empty', 'The file is empty')
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    const prefix = JS_PREFIX.exec(trimmed)
    if (prefix) {
      const body = trimmed.slice(prefix[0].length).replace(/;\s*$/, '').trim()
      try {
        const value: unknown = JSON.parse(body)
        warnings?.push({ code: 'js-snippet' })
        return value
      } catch {
        // Fall through and report the position in the original text.
      }
    }
    const loc = locateJsonError(trimmed)
    const msg = error instanceof Error ? error.message : 'Invalid JSON'
    throw new LottieFileError(
      'invalid-json',
      msg,
      loc ? { line: loc.line, column: loc.column, found: loc.found } : {},
    )
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Keys that API responses and embed snippets typically wrap animations in (checked first). */
const WRAPPER_KEYS = [
  'animationData',
  'animation',
  'lottie',
  'data',
  'json',
  'content',
  'result',
  'payload',
  'file',
  'body',
]

/**
 * Finds the Lottie animations inside a parsed JSON value: the value itself, the Lottie entries
 * of a top-level array, or the first animation inside a wrapper object (breadth-first, a few
 * levels deep; JSON strings holding an animation are parsed too).
 */
export function findLotties(value: unknown): { value: Animation; path: string[] }[] {
  if (looksLikeLottie(value)) return [{ value, path: [] }]
  if (Array.isArray(value)) {
    const found = value
      .map((v, index) => ({ value: v as unknown, path: [String(index)] }))
      .filter((e): e is { value: Animation; path: string[] } => looksLikeLottie(e.value))
    if (found.length) return found
  }
  const queue: { value: unknown; path: string[] }[] = [{ value, path: [] }]
  let budget = 2000
  while (queue.length && budget-- > 0) {
    const { value: node, path } = queue.shift()!
    if (path.length > 4) continue
    const children: [string, unknown][] = Array.isArray(node)
      ? node.slice(0, 20).map((v, index) => [String(index), v])
      : isRecord(node)
        ? [
            ...WRAPPER_KEYS.filter((k) => k in node).map((k): [string, unknown] => [k, node[k]]),
            ...Object.entries(node)
              .filter(([k]) => !WRAPPER_KEYS.includes(k))
              .slice(0, 50),
          ]
        : []
    for (const [key, child] of children) {
      let candidate = child
      if (
        typeof child === 'string' &&
        child.length > 20 &&
        child.trimStart().startsWith('{') &&
        child.includes('"layers"')
      ) {
        try {
          candidate = JSON.parse(child)
        } catch {
          continue
        }
      }
      if (looksLikeLottie(candidate)) return [{ value: candidate, path: [...path, key] }]
      if (candidate !== null && typeof candidate === 'object')
        queue.push({ value: candidate, path: [...path, key] })
    }
  }
  return []
}

/** Explains what a non-Lottie JSON seems to be (undefined when unknown). */
export function notLottieHint(value: unknown): NotLottieHint | undefined {
  if (!isRecord(value)) return undefined
  if (
    Array.isArray(value.animations) &&
    value.animations.some((a) => isRecord(a) && typeof a.id === 'string')
  ) {
    return 'dotlottie-manifest'
  }
  if (Array.isArray(value.rules)) return 'theme'
  if (
    Array.isArray(value.states) &&
    ('initial' in value || 'interactions' in value || 'inputs' in value)
  ) {
    return 'state-machine'
  }
  if (
    Array.isArray(value.layers) ||
    Array.isArray(value.shapes) ||
    (typeof value.ty === 'number' && isRecord(value.ks))
  ) {
    return 'partial'
  }
  return undefined
}

/* -------------------------------------------------------------------------- */
/*                               External images                              */
/* -------------------------------------------------------------------------- */

function cleanRef(s: string): string {
  return s
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function isResolvableRef(p: string, e: unknown): boolean {
  return e === 1 || /^(data:|blob:|https?:)/i.test(p)
}

/** References (`u` + `p`) of image assets that point to files outside the document. */
export function externalImageRefs(anim: Animation): string[] {
  const refs: string[] = []
  for (const asset of anim.assets ?? []) {
    if (!isImageAsset(asset) || !asset.p || isResolvableRef(asset.p, asset.e)) continue
    refs.push(cleanRef(`${asset.u ?? ''}${asset.p}`))
  }
  return refs
}

/**
 * Embeds image files into assets that reference them (matched by relative path, then by unique
 * file name, case-insensitively). Mutates `anim`; returns the number of assets embedded.
 * Works on immer drafts too.
 */
export function resolveExternalImages(anim: Animation, images: NamedBytes[]): number {
  if (!images.length) return 0
  const byPath = new Map<string, NamedBytes>()
  const byName = new Map<string, NamedBytes[]>()
  for (const img of images) {
    if (img.path) byPath.set(cleanRef(img.path).toLowerCase(), img)
    const key = img.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), img])
  }
  let count = 0
  for (const asset of anim.assets ?? []) {
    if (!isImageAsset(asset) || !asset.p || isResolvableRef(asset.p, asset.e)) continue
    let ref = `${asset.u ?? ''}${asset.p}`
    try {
      ref = decodeURIComponent(ref)
    } catch {
      // keep the raw reference
    }
    ref = cleanRef(ref).toLowerCase()
    const candidates = byName.get(baseName(ref)) ?? []
    const hit = byPath.get(ref) ?? (candidates.length === 1 ? candidates[0] : undefined)
    if (!hit) continue
    asset.p = toDataUri(hit.bytes, hit.name)
    asset.u = ''
    asset.e = 1
    count++
  }
  return count
}

/* -------------------------------------------------------------------------- */
/*                                   Reading                                  */
/* -------------------------------------------------------------------------- */

/**
 * The display name stored in an animation's `nm`, trimmed; "" when there is none. Real files
 * sometimes store numbers (or other junk) there, which must not make the animation unreadable.
 */
export function animationName(nm: unknown): string {
  if (typeof nm === 'string') return nm.trim()
  return typeof nm === 'number' && Number.isFinite(nm) ? String(nm) : ''
}

function manifestName(meta: Record<string, unknown>): string | undefined {
  return typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : undefined
}

/** Validates and normalizes one animation; null when it is not a usable Lottie animation. */
function toOpened(id: string, data: unknown, name?: string): OpenedAnimation | null {
  try {
    const { animation, repairs } = fromObject(data)
    return { id, name: name ?? (animationName(animation.nm) || id), data: animation, repairs }
  } catch {
    return null
  }
}

function openJson(
  bytes: Uint8Array,
  fileName: string,
  kind: 'json' | 'tgs',
  opts: ReadLottieOptions,
): OpenResult {
  let raw = bytes
  if (kind === 'tgs') {
    try {
      raw = gunzipSync(bytes)
    } catch (e) {
      throw new LottieFileError(
        'corrupt-gzip',
        e instanceof Error ? e.message : 'Invalid gzip data',
      )
    }
  }
  const warnings: OpenWarning[] = []
  const json = parseJsonText(decodeText(raw), warnings)
  const found = findLotties(json)
  if (!found.length) {
    throw new LottieFileError('not-lottie', 'This JSON is not a Lottie animation', {
      hint: notLottieHint(json),
    })
  }
  if (found.length === 1 && found[0].path.length)
    warnings.push({ code: 'unwrapped', subject: found[0].path.join('.') })
  const stem = fileStem(fileName)
  const animations = found
    .map((f, index) => toOpened(found.length > 1 ? `${stem}-${index + 1}` : stem, f.value))
    .filter((a): a is OpenedAnimation => a !== null)
  if (!animations.length)
    throw new LottieFileError('not-lottie', 'This JSON is not a Lottie animation')
  const images = opts.images ?? []
  const external = new Set<string>()
  for (const a of animations) {
    resolveExternalImages(a.data, images)
    for (const ref of externalImageRefs(a.data)) external.add(ref)
  }
  if (external.size) {
    const refs = [...external]
    warnings.push({
      code: 'external-images',
      count: refs.length,
      subject: refs.slice(0, 3).join(', '),
    })
  }
  return { kind, fileName, size: bytes.length, animations, activeId: animations[0].id, warnings }
}

function openArchive(
  bytes: Uint8Array,
  fileName: string,
  kind: 'dotlottie' | 'zip',
  opts: ReadLottieOptions,
): OpenResult {
  let file: DotLottieFile
  try {
    file = readDotLottie(bytes)
  } catch (e) {
    if (e instanceof DotLottieError && e.code === 'no-animation')
      throw new LottieFileError('no-animation', e.message)
    throw new LottieFileError('corrupt-zip', e instanceof Error ? e.message : 'Unreadable archive')
  }
  const isDotLottie = file.manifest !== null || kind === 'dotlottie'
  // A plain ZIP export has no manifest by design: that is not worth a warning.
  const warnings: OpenWarning[] = file.warnings.filter(
    (w) => isDotLottie || w.code !== 'no-manifest',
  )
  const animations: OpenedAnimation[] = []
  for (const a of file.animations) {
    const opened = toOpened(a.id, a.data, manifestName(a.meta))
    if (opened) animations.push(opened)
    else warnings.push({ code: 'invalid-animation', subject: a.id })
  }
  if (!animations.length)
    throw new LottieFileError('no-animation', 'No Lottie animation found in the archive')
  const images = opts.images ?? []
  for (const a of animations) resolveExternalImages(a.data, images)
  const activeId = animations.some((a) => a.id === file.activeId) ? file.activeId : animations[0].id
  // Validated animations replace the raw ones so the container holds normalized data; animations
  // the editor cannot open stay in the container untouched, so saving never drops them.
  const byId = new Map(animations.map((a) => [a.id, a.data]))
  const normalized: DotLottieFile = {
    ...file,
    activeId,
    animations: file.animations.map((a) => ({ ...a, data: byId.get(a.id) ?? a.data })),
  }
  return {
    kind: isDotLottie ? 'dotlottie' : 'zip',
    fileName,
    size: bytes.length,
    animations,
    activeId,
    dotLottie: isDotLottie ? normalized : undefined,
    warnings,
  }
}

/** True for small files that contain only whitespace. */
function isBlank(bytes: Uint8Array): boolean {
  return bytes.length <= 4096 && !decodeText(bytes).trim()
}

/**
 * Reads a file's bytes in any supported format. Throws LottieFileError when it cannot be
 * opened; `images` resolves external image references (Bodymovin exports).
 */
export function readLottieBytes(
  bytes: Uint8Array,
  fileName: string,
  opts: ReadLottieOptions = {},
): OpenResult {
  if (bytes.length === 0 || isBlank(bytes)) throw new LottieFileError('empty', 'The file is empty')
  const kind = sniffFormat(bytes, fileName)
  switch (kind) {
    case 'json':
    case 'tgs':
      return openJson(bytes, fileName, kind, opts)
    case 'dotlottie':
    case 'zip':
      return openArchive(bytes, fileName, kind, opts)
    default: {
      const ext = fileExtension(fileName)
      const mime = sniffMime(bytes) ?? mimeFromFileName(fileName)
      if (mime?.startsWith('image/'))
        throw new LottieFileError('image', 'Images cannot be opened as animations', { detail: ext })
      const head = textHead(bytes).toLowerCase()
      if (
        head.startsWith('<!doctype html') ||
        head.startsWith('<html') ||
        (head.startsWith('<') && head.includes('<body'))
      ) {
        throw new LottieFileError('html', 'This is a web page, not a Lottie file')
      }
      if (ext === 'lottie')
        throw new LottieFileError('corrupt-zip', 'This .lottie file is not a ZIP archive')
      if (ext === 'tgs')
        throw new LottieFileError('corrupt-gzip', 'This .tgs file is not gzip data')
      throw new LottieFileError('unsupported', 'Unsupported file type', { detail: ext })
    }
  }
}

/** Reads a File/Blob (see readLottieBytes). */
export async function readLottieFile(
  file: Blob & { name?: string },
  opts: ReadLottieOptions = {},
): Promise<OpenResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return readLottieBytes(bytes, file.name || 'animation.json', opts)
}

/* -------------------------------------------------------------------------- */
/*                                   Writing                                  */
/* -------------------------------------------------------------------------- */

/** Telegram sticker bytes: minified JSON, gzipped. */
export function writeTgs(anim: Animation): Uint8Array<ArrayBuffer> {
  return gzipSync(strToU8(JSON.stringify(anim)), { level: 9 })
}
