/**
 * The export formats: list grouping, icons, file extensions and what each needs (rendering,
 * copy button, marking the document as saved).
 */
import {
  Clapperboard,
  Code2,
  FileArchive,
  FileJson,
  Film,
  Image,
  ImagePlay,
  Images,
  PenTool,
  Send,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { IconProps } from '@/commands/registry'
import type { Dict } from '@/i18n'
import { embedFileExtension, isInline } from '@/export/embed'
import { embeddedImageCount, isFaithful, tgsIsFaithful } from '@/export/lottie-files'
import { fileStem } from '@/lottie/formats'
import type { Animation } from '@/lottie/types'
import { sanitizeFileName } from '@/lib/download'
import type { ExportFormat, ExportPrefs } from './store'

export type FormatGroup = 'animation' | 'video' | 'images' | 'developers'

export interface FormatInfo {
  id: ExportFormat
  group: FormatGroup
  icon: ComponentType<IconProps>
  /** Renders frames (takes time, shows progress, can be cancelled). */
  rendered: boolean
  /** Offers "Copy" next to "Export". */
  copy: boolean
}

export const FORMATS: Record<ExportFormat, FormatInfo> = {
  json: { id: 'json', group: 'animation', icon: FileJson, rendered: false, copy: true },
  dotlottie: {
    id: 'dotlottie',
    group: 'animation',
    icon: FileArchive,
    rendered: false,
    copy: false,
  },
  tgs: { id: 'tgs', group: 'animation', icon: Send, rendered: false, copy: false },
  gif: { id: 'gif', group: 'video', icon: ImagePlay, rendered: true, copy: false },
  mp4: { id: 'mp4', group: 'video', icon: Film, rendered: true, copy: false },
  webm: { id: 'webm', group: 'video', icon: Clapperboard, rendered: true, copy: false },
  png: { id: 'png', group: 'images', icon: Images, rendered: true, copy: false },
  framePng: { id: 'framePng', group: 'images', icon: Image, rendered: false, copy: true },
  frameSvg: { id: 'frameSvg', group: 'images', icon: PenTool, rendered: false, copy: true },
  embed: { id: 'embed', group: 'developers', icon: Code2, rendered: false, copy: true },
}

/**
 * The exported file is a faithful copy of the document, so exporting counts as saving it
 * (clears the "edited" dot). Rounded numbers, stripped names and sticker fixes lose data: the
 * document stays "edited" after those.
 */
export function exportKeepsDocument(
  format: ExportFormat,
  prefs: ExportPrefs,
  doc: Animation,
): boolean {
  switch (format) {
    case 'json':
      return isFaithful(prefs.json)
    case 'dotlottie':
      return true
    case 'tgs':
      return tgsIsFaithful(doc, prefs.tgs)
    case 'embed':
      // The file the snippet loads (.json or .lottie); an inline snippet downloads a web page.
      return !isInline(prefs.embed)
    default:
      return false
  }
}

export const GROUPS: { id: FormatGroup; formats: ExportFormat[] }[] = [
  { id: 'animation', formats: ['json', 'dotlottie', 'tgs'] },
  { id: 'video', formats: ['gif', 'mp4', 'webm'] },
  { id: 'images', formats: ['png', 'framePng', 'frameSvg'] },
  { id: 'developers', formats: ['embed'] },
]

/** Formats in list order (keyboard navigation). */
export const FORMAT_ORDER: ExportFormat[] = GROUPS.flatMap((g) => g.formats)

export function formatName(t: Dict, format: ExportFormat): string {
  return t.export.formats[format].name
}

/** File extension of an export with the current options. */
export function formatExtension(
  format: ExportFormat,
  prefs: ExportPrefs,
  doc: Animation | null,
): string {
  switch (format) {
    case 'json':
      return prefs.json.images === 'files' && doc && embeddedImageCount(doc) > 0 ? 'zip' : 'json'
    case 'dotlottie':
      return 'lottie'
    case 'tgs':
      return 'tgs'
    case 'gif':
      return 'gif'
    case 'mp4':
      return 'mp4'
    case 'webm':
      return 'webm'
    case 'png':
      return 'zip'
    case 'framePng':
      return 'png'
    case 'frameSvg':
      return 'svg'
    case 'embed':
      return embedFileExtension(prefs.embed)
  }
}

/** Base name (no extension) suggested for an export of the document. */
export function defaultBaseName(
  format: ExportFormat,
  fileName: string,
  frame: number,
  still = false,
): string {
  const stem = sanitizeFileName(fileStem(fileName || 'animation'), 'animation')
  if (still && isStillFormat(format)) return `${stem}-frame-${Math.max(0, Math.round(frame))}`
  switch (format) {
    case 'png':
      return `${stem}-frames`
    case 'framePng':
    case 'frameSvg':
      return `${stem}-frame-${Math.max(0, Math.round(frame))}`
    default:
      return stem
  }
}

/** Formats that can hold one frame as a still Lottie instead of the animation. */
export function isStillFormat(format: ExportFormat): format is 'json' | 'dotlottie' | 'tgs' {
  return format === 'json' || format === 'dotlottie' || format === 'tgs'
}

/** Joins a (user-edited) base name and an extension into a safe file name. */
export function joinFileName(base: string, ext: string): string {
  const clean = sanitizeFileName(base.trim().replace(/\.+$/, ''), 'animation')
  return `${clean}.${ext}`
}
