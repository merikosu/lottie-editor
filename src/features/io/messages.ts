/**
 * Translated, human messages for errors and warnings of the open flow.
 * Tone: what happened, why, what to do. No blame, no jargon where it can be avoided.
 */
import type { Dict } from '@/i18n'
import { DotLottieError } from '@/lottie/dotlottie'
import { LottieFileError, type OpenWarning } from '@/lottie/formats'
import { FetchFileError } from './fetchUrl'
import { StorageError } from './storage'

export interface Message {
  title: string
  /** One sentence or a few short lines. */
  lines: string[]
}

function describeFileError(e: LottieFileError, t: Dict): string {
  const E = t.io.errors
  switch (e.code) {
    case 'empty':
      return E.empty
    case 'invalid-json': {
      if (e.line === undefined || e.column === undefined) return E.invalidJson
      if (e.found === null || e.found === undefined) return E.invalidJsonEnd(e.line)
      const found = e.found === '\n' || e.found === '\r' ? E.lineBreak : E.quote(e.found)
      return E.invalidJsonAt(found, e.line, e.column)
    }
    case 'not-lottie':
      return e.hint ? `${E.notLottie} ${E.hints[e.hint]}` : E.notLottie
    case 'corrupt-zip':
      return E.corruptZip
    case 'no-animation':
      return E.noAnimation
    case 'corrupt-gzip':
      return E.corruptGzip
    case 'html':
      return E.html
    case 'image':
      return `${E.image} ${E.imageNoDoc}`
    case 'unsupported':
      return E.unsupported(e.detail ?? '')
  }
}

function describeFetchError(e: FetchFileError, t: Dict): string {
  const E = t.io.errors
  switch (e.code) {
    case 'invalid-url':
      return t.io.openUrl.invalid
    case 'network':
      return E.network
    case 'http':
      return E.http(e.status ?? 0, e.statusText ?? '')
    case 'too-large':
      return E.tooLarge
  }
}

/** Explains why a file could not be opened. */
export function describeOpenError(error: unknown, fileName: string | null, t: Dict): Message {
  const title = fileName ? t.io.errors.openTitle(fileName) : t.io.errors.openTitleGeneric
  if (error instanceof LottieFileError) return { title, lines: [describeFileError(error, t)] }
  if (error instanceof FetchFileError)
    return { title: t.io.errors.downloadTitle, lines: [describeFetchError(error, t)] }
  if (error instanceof StorageError) return { title, lines: [storageLine(error, t)] }
  if (
    error instanceof DOMException &&
    (error.name === 'NotReadableError' || error.name === 'NotFoundError')
  ) {
    return { title, lines: [t.io.errors.readFailed] }
  }
  return { title, lines: [t.io.errors.unexpected] }
}

function storageLine(error: StorageError, t: Dict): string {
  return error.reason === 'quota' ? t.io.errors.storageFull : t.io.errors.storageUnavailable
}

/** Explains a failure of the browser storage (recent files, session). */
export function describeStorageError(error: unknown, t: Dict): Message {
  const reason =
    error instanceof StorageError ? error : new StorageError('unavailable', String(error))
  return { title: t.io.errors.storageTitle, lines: [storageLine(reason, t)] }
}

/** Explains why saving/downloading failed. */
export function describeSaveError(error: unknown, t: Dict): Message {
  if (error instanceof DotLottieError && error.code === 'v2-required') {
    return { title: t.io.errors.saveFailed, lines: [t.io.errors.v2Required] }
  }
  if (error instanceof StorageError)
    return { title: t.io.errors.saveFailed, lines: [storageLine(error, t)] }
  // Anything else is a bug or the browser running out of memory: no raw (English) message.
  console.error('Saving failed', error)
  return { title: t.io.errors.saveFailed, lines: [t.io.errors.saveUnexpected] }
}

/** One line per warning; null for notes that need no attention (conveniences that worked). */
export function describeWarning(w: OpenWarning, t: Dict): string | null {
  const W = t.io.warnings
  const s = w.subject ?? ''
  switch (w.code) {
    case 'nested-folder':
    case 'unwrapped':
    case 'js-snippet':
      return null
    case 'no-manifest':
      return W['no-manifest']
    case 'invalid-manifest':
      return W['invalid-manifest']
    case 'missing-animation':
      return W['missing-animation'](s)
    case 'unlisted-animation':
      return W['unlisted-animation'](s)
    case 'invalid-animation':
      return W['invalid-animation'](s)
    case 'missing-asset':
      return W['missing-asset'](s)
    case 'external-asset':
      return W['external-asset'](s)
    case 'missing-entry':
      return W['missing-entry'](s)
    case 'invalid-entry':
      return W['invalid-entry'](s)
    case 'skipped-entry':
      return W['skipped-entry'](s)
    case 'salvaged':
      return W.salvaged
    case 'corrupt-entry':
      return s ? W['corrupt-entry'](s) : W.salvaged
    case 'external-images':
      return W['external-images'](w.count ?? 1, s)
  }
}

/** Translates the (English) repair notes of normalizeAnimation. */
export function translateRepair(repair: string, t: Dict): string {
  const R = t.io.repairs
  const fps = /^Invalid frame rate "(.*)" replaced with 30\.$/.exec(repair)
  if (fps) return R.frameRate(fps[1])
  switch (repair) {
    case 'Missing in point (ip) set to 0.':
      return R.inPoint
    case 'Invalid out point (op) repaired.':
      return R.outPoint
    case 'Invalid width replaced with 512.':
      return R.width
    case 'Invalid height replaced with 512.':
      return R.height
    case 'Missing layers array created.':
      return R.layers
    default:
      return repair
  }
}

const MAX_LINES = 4

/** One summary for everything worth mentioning after a successful open; null when all is fine. */
export function summarizeOpen(repairs: string[], warnings: OpenWarning[], t: Dict): Message | null {
  const fixed = repairs.map((r) => translateRepair(r, t))
  const notes = [
    ...new Set(warnings.map((w) => describeWarning(w, t)).filter((l): l is string => !!l)),
  ]
  if (!fixed.length && !notes.length) return null
  const W = t.io.warnings
  const title =
    fixed.length && notes.length
      ? W.both(fixed.length, notes.length)
      : fixed.length
        ? W.repairs(fixed.length)
        : W.notes(notes.length)
  const all = [...fixed, ...notes]
  const lines =
    all.length > MAX_LINES
      ? [...all.slice(0, MAX_LINES - 1), W.more(all.length - MAX_LINES + 1)]
      : all
  return { title, lines }
}
