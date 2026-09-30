/**
 * Lottie file exports: JSON (minified or pretty, reduced precision, without names, images
 * embedded or as separate files), dotLottie and Telegram stickers (.tgs).
 *
 * Every builder works on a copy: the editor document is frozen and is never changed by an
 * export. Nothing here touches the DOM, so everything is unit-tested in Node.
 */
import { gzipSync, strToU8, zipSync, type Zippable } from 'fflate'
import { dataUriToBytes, imageMime, isDataUri, mimeToExtension } from '@/lottie/assets'
import { resizeCanvas } from '@/lottie/canvas'
import {
  isDotLottieContainer,
  needsDotLottieV2,
  writeDotLottie,
  type DotLottieContainer,
  type DotLottieVersion,
} from '@/lottie/dotlottie'
import { fileStem, writeTgs } from '@/lottie/formats'
import { roundNumbers } from '@/lottie/precision'
import { changeFrameRate, setDuration, trimToRange } from '@/lottie/timing'
import type { Animation, ImageAsset } from '@/lottie/types'
import { isImageAsset, isPrecompAsset } from '@/lottie/types'

/* -------------------------------------------------------------------------- */
/*                               Shared transforms                             */
/* -------------------------------------------------------------------------- */

/** Decimal places kept for coordinates and times ('keep' leaves numbers untouched). */
export type PrecisionOption = 'keep' | '3' | '2' | '1'

export interface DocumentTransform {
  precision: PrecisionOption
  /** Remove layer, shape and asset names (`nm`, `mn`). The root animation name stays. */
  stripNames: boolean
}

/** Deep copy (JSON): breaks aliasing and drops anything that is not plain data. */
export function cloneDocument(doc: Animation): Animation {
  return JSON.parse(JSON.stringify(doc)) as Animation
}

/**
 * Rounds numbers to `decimals` places. Frame rates are restored afterwards: 29.97 must not
 * become 30.0 at one decimal (it would change the timing of the whole animation).
 */
export function roundDocument(doc: Animation, decimals: number): Animation {
  const rounded = roundNumbers(doc, { decimals })
  rounded.fr = doc.fr
  doc.assets?.forEach((asset, i) => {
    const target = rounded.assets?.[i]
    if (target && isPrecompAsset(asset) && 'fr' in asset && typeof asset.fr === 'number') {
      ;(target as { fr?: number }).fr = asset.fr
    }
  })
  return rounded
}

const NAME_KEYS = new Set(['nm', 'mn'])

function withoutNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNames)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (!NAME_KEYS.has(key)) out[key] = withoutNames(child)
    }
    return out
  }
  return value
}

/** Copy without `nm` / `mn` anywhere below the root (the root name is kept). */
export function stripNames(doc: Animation): Animation {
  const out = withoutNames(doc) as Animation
  if (doc.nm !== undefined) out.nm = doc.nm
  return out
}

/** The transform keeps every number and name: the file is a faithful copy of the document. */
export function isFaithful(t: DocumentTransform): boolean {
  return t.precision === 'keep' && !t.stripNames
}

/**
 * Applies precision and name stripping. Returns `doc` itself when nothing changes, so callers
 * can memoize by identity.
 */
export function transformDocument(doc: Animation, t: DocumentTransform): Animation {
  let out = doc
  if (t.precision !== 'keep') out = roundDocument(out, Number(t.precision))
  if (t.stripNames) out = stripNames(out)
  return out
}

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return strToU8(text) as Uint8Array<ArrayBuffer>
}

/** Size of the gzipped bytes (what a server sends with compression on). */
export function gzipSize(bytes: Uint8Array): number {
  return gzipSync(bytes, { level: 9 }).length
}

/* -------------------------------------------------------------------------- */
/*                                  Lottie JSON                               */
/* -------------------------------------------------------------------------- */

export interface JsonOptions extends DocumentTransform {
  pretty: boolean
  /** 'files': embedded images are written next to the JSON (the export becomes a .zip). */
  images: 'embed' | 'files'
}

export function serializeJson(doc: Animation, pretty: boolean): string {
  return JSON.stringify(doc, null, pretty ? 2 : undefined)
}

/** Number of embedded (data URI) images, which the "separate files" option can extract. */
export function embeddedImageCount(doc: Animation): number {
  return (doc.assets ?? []).filter((a) => isImageAsset(a) && isDataUri(a.p)).length
}

/**
 * Moves embedded images out of the JSON: each becomes `images/<name>.<ext>` referenced with
 * `u: "images/"` (the Bodymovin layout, which every player resolves next to the JSON).
 */
export function extractImages(doc: Animation): {
  doc: Animation
  files: Record<string, Uint8Array>
} {
  const copy = cloneDocument(doc)
  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  for (const asset of copy.assets ?? []) {
    if (!isImageAsset(asset) || !isDataUri(asset.p)) continue
    let bytes: Uint8Array
    try {
      bytes = dataUriToBytes(asset.p)
    } catch {
      continue // A broken data URI stays embedded rather than failing the export.
    }
    const ext = mimeToExtension(imageMime(asset as ImageAsset))
    const stem =
      (asset.id || 'image').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '') || 'image'
    let name = `${stem}.${ext}`
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}_${n}.${ext}`
    used.add(name.toLowerCase())
    files[`images/${name}`] = bytes
    asset.u = 'images/'
    asset.p = name
    asset.e = 0
  }
  return { doc: copy, files }
}

export interface BuiltFile {
  bytes: Uint8Array<ArrayBuffer>
  /** Extension without the dot. */
  ext: string
  mime: string
}

/** The Lottie JSON export (or a .zip with the JSON and its images). */
export function buildJsonFile(doc: Animation, opts: JsonOptions, fileName: string): BuiltFile {
  const transformed = transformDocument(doc, opts)
  if (opts.images === 'files' && embeddedImageCount(transformed) > 0) {
    const { doc: withRefs, files } = extractImages(transformed)
    const stem = fileStem(fileName)
    const entries: Zippable = {
      [`${stem}.json`]: [utf8(serializeJson(withRefs, opts.pretty)), { level: 9 }],
    }
    for (const [path, bytes] of Object.entries(files)) entries[path] = [bytes, { level: 0 }]
    return { bytes: zipSync(entries), ext: 'zip', mime: 'application/zip' }
  }
  return {
    bytes: utf8(serializeJson(transformed, opts.pretty)),
    ext: 'json',
    mime: 'application/json',
  }
}

/* -------------------------------------------------------------------------- */
/*                                   dotLottie                                */
/* -------------------------------------------------------------------------- */

export interface DotLottieOptions {
  version: 'auto' | '1' | '2'
  /** Move embedded images into the archive as files (smaller, the dotLottie way). */
  extractImages: boolean
  /** Keep the other animations and state machines of the .lottie the document came from. */
  includePackage: boolean
  /**
   * Write the package's themes (dotLottie 2). Unset: themes follow `includePackage` (the
   * behaviour before themes could be edited).
   */
  themes?: boolean
  loop: boolean
  autoplay: boolean
  speed: number
  bounce: boolean
}

export interface PackageInfo {
  /** Animations besides the edited one. */
  otherAnimations: number
  themes: number
  /** Theme names (manifest `name`, else id), in manifest order. */
  themeNames?: string[]
  stateMachines: number
  /** The package can only be written as dotLottie 2. */
  needsV2: boolean
  /** The package without its themes still needs dotLottie 2 (state machines, v2-only files). */
  needsV2WithoutThemes?: boolean
  /** Layout of the file the document was opened from. */
  version: DotLottieVersion
}

/** What the original .lottie holds besides the edited animation (null for other documents). */
export function packageInfo(dotLottieMeta: unknown): PackageInfo | null {
  if (!isDotLottieContainer(dotLottieMeta)) return null
  return {
    otherAnimations: Math.max(0, dotLottieMeta.animations.length - 1),
    themes: dotLottieMeta.themes.length,
    themeNames: dotLottieMeta.themes.map((t) => t.name?.trim() || t.id),
    stateMachines: dotLottieMeta.stateMachines.length,
    needsV2: needsDotLottieV2(dotLottieMeta),
    needsV2WithoutThemes: needsDotLottieV2(withoutThemes(dotLottieMeta)),
    version: dotLottieMeta.version,
  }
}

/** Whether the export writes the package's themes (see `DotLottieOptions.themes`). */
export function includesThemes(opts: Pick<DotLottieOptions, 'includePackage' | 'themes'>): boolean {
  return opts.themes ?? opts.includePackage
}

/** A container without themes (and without the animations' references to them). */
function withoutThemes(container: DotLottieContainer): DotLottieContainer {
  if (container.themes.length === 0) return container
  return {
    ...container,
    themes: [],
    animations: container.animations.map((a) => {
      if (!('initialTheme' in a.meta) && !('themes' in a.meta)) return a
      const meta = { ...a.meta }
      delete meta.initialTheme
      delete meta.themes
      return { ...a, meta }
    }),
  }
}

/**
 * The container an export writes: the whole package, the package without its themes, or only
 * the edited animation with its themes (and the image files theme rules may name). Undefined
 * when nothing of the package is written.
 */
export function exportContainer(
  dotLottieMeta: unknown,
  opts: Pick<DotLottieOptions, 'includePackage' | 'themes'>,
): DotLottieContainer | undefined {
  if (!isDotLottieContainer(dotLottieMeta)) return undefined
  const themes = includesThemes(opts) && dotLottieMeta.themes.length > 0
  if (opts.includePackage) return themes ? dotLottieMeta : withoutThemes(dotLottieMeta)
  if (!themes) return undefined
  const active = dotLottieMeta.animations.find((a) => a.id === dotLottieMeta.activeId)
  const meta: Record<string, unknown> = {}
  if (typeof active?.meta.initialTheme === 'string') meta.initialTheme = active.meta.initialTheme
  if (Array.isArray(active?.meta.themes)) meta.themes = active.meta.themes
  const extraFiles: Record<string, Uint8Array> = {}
  for (const [path, bytes] of Object.entries(dotLottieMeta.extraFiles))
    if (/^(i|images)\//.test(path)) extraFiles[path] = bytes
  return {
    kind: 'dotlottie',
    version: 2,
    manifest: null,
    activeId: dotLottieMeta.activeId,
    animations: [{ id: dotLottieMeta.activeId, meta }],
    themes: dotLottieMeta.themes,
    stateMachines: [],
    extraFiles,
  }
}

/** True when the chosen contents can only be written as dotLottie 2 (themes, state machines). */
export function exportNeedsV2(
  opts: Pick<DotLottieOptions, 'includePackage' | 'themes'>,
  info: PackageInfo | null,
): boolean {
  if (!info) return false
  const themes = includesThemes(opts) && info.themes > 0
  const rest = opts.includePackage && (info.needsV2WithoutThemes ?? info.needsV2)
  return themes || rest
}

/** Version the export will be written in. */
export function resolveDotLottieVersion(
  opts: Pick<DotLottieOptions, 'version' | 'includePackage' | 'themes'>,
  info: PackageInfo | null,
): DotLottieVersion {
  const needsV2 = exportNeedsV2(opts, info)
  if (opts.version === '1' || opts.version === '2') {
    // v1 cannot hold themes or state machines: never drop them silently.
    if (opts.version === '1' && needsV2) return 2
    return Number(opts.version) as DotLottieVersion
  }
  if (needsV2) return 2
  if (opts.includePackage && info) return info.version
  return 1
}

export function buildDotLottie(
  doc: Animation,
  opts: DotLottieOptions,
  fileName: string,
  dotLottieMeta: unknown,
): BuiltFile {
  const info = packageInfo(dotLottieMeta)
  const container = exportContainer(dotLottieMeta, opts)
  const version = resolveDotLottieVersion(opts, info)
  const id = container ? container.activeId : fileStem(fileName)
  const bytes = writeDotLottie({
    animations: [{ id, data: doc }],
    container,
    version,
    options: {
      generator: 'Lottie Editor',
      extractImages: opts.extractImages,
      playback: {
        loop: opts.loop,
        autoplay: opts.autoplay,
        speed: opts.speed > 0 && Number.isFinite(opts.speed) ? opts.speed : 1,
        playMode: opts.bounce ? 'bounce' : 'normal',
      },
    },
  })
  return { bytes, ext: 'lottie', mime: 'application/zip' }
}

/* -------------------------------------------------------------------------- */
/*                              Telegram stickers                             */
/* -------------------------------------------------------------------------- */

/** Telegram's rules for animated stickers (core.telegram.org/stickers). */
export const TGS_RULES = {
  width: 512,
  height: 512,
  fps: 60,
  maxSeconds: 3,
  /** 64 KB after gzip. */
  maxBytes: 64 * 1024,
} as const

export interface TgsOptions extends DocumentTransform {
  /** Scale the content into a 512 × 512 canvas. */
  fitSize: boolean
  /** Retime to 60 fps (same duration). */
  fixFps: boolean
  /** Make it at most 3 s long: 'trim' keeps the first 3 s, 'speed' plays everything faster. */
  duration: 'keep' | 'trim' | 'speed'
}

/** Which sticker fixes change this document (the conditions `buildTgsDocument` applies them on). */
export function tgsFixesApplied(
  doc: Animation,
  opts: TgsOptions,
): { size: boolean; fps: boolean; duration: boolean } {
  const seconds = doc.fr > 0 ? (doc.op - doc.ip) / doc.fr : 0
  return {
    size: opts.fitSize && (doc.w !== TGS_RULES.width || doc.h !== TGS_RULES.height),
    fps: opts.fixFps && Math.abs(doc.fr - TGS_RULES.fps) > 1e-6,
    duration: opts.duration !== 'keep' && seconds > TGS_RULES.maxSeconds + 1e-6,
  }
}

/** The sticker holds the document unchanged (no fixes, numbers and names kept). */
export function tgsIsFaithful(doc: Animation, opts: TgsOptions): boolean {
  const fixes = tgsFixesApplied(doc, opts)
  return isFaithful(opts) && !fixes.size && !fixes.fps && !fixes.duration
}

/** The document as it will be written into the sticker (fixes applied to a copy). */
export function buildTgsDocument(doc: Animation, opts: TgsOptions): Animation {
  const fixes = tgsFixesApplied(doc, opts)
  const copy = cloneDocument(doc)
  if (fixes.size) {
    resizeCanvas(copy, TGS_RULES.width, TGS_RULES.height, {
      mode: 'scale',
      anchor: 'center',
      name: 'Sticker',
    })
  }
  // The frame rate change keeps the duration, so the length fix sees the same seconds.
  if (fixes.fps) changeFrameRate(copy, TGS_RULES.fps, { keepDuration: true })
  if (fixes.duration) {
    if (opts.duration === 'trim') {
      trimToRange(copy, copy.ip, copy.ip + Math.round(TGS_RULES.maxSeconds * copy.fr), {
        clipMarkers: true,
      })
    } else {
      setDuration(copy, TGS_RULES.maxSeconds)
    }
  }
  return transformDocument(copy, opts)
}

/** Sticker bytes: minified JSON with Telegram's `tgs: 1` marker, gzipped. */
export function encodeTgs(doc: Animation): Uint8Array<ArrayBuffer> {
  return writeTgs({ ...doc, tgs: 1 } as Animation)
}
