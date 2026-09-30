/**
 * Reading a dropped file into the parts of a job: every format the editor opens (JSON, dotLottie,
 * Telegram stickers, ZIP exports with images), through the same reader as the editor.
 */
import { createDotLottieContainer, type DotLottieContainer } from '@/lottie/dotlottie'
import {
  readLottieBytes,
  type NamedBytes,
  type OpenResult,
  type OpenedAnimation,
} from '@/lottie/formats'
import { isImageAsset, type Animation } from '@/lottie/types'
import type { InputFormat, Job, JobPart, PartInfo } from './types'

export interface ReadResult {
  parts: JobPart[]
  container: DotLottieContainer | null
  input: InputFormat
  inputSize: number
  /** The first animation, parsed (for its thumbnail). */
  first: Animation
}

/** Lets the browser paint the "Reading" state before a long synchronous parse. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

const BOM = 0xfeff

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** Facts the UI shows before any result: size, rate, duration, embedded images. */
export function partInfo(doc: Animation): PartInfo {
  const ip = num(doc.ip, 0)
  return {
    width: num(doc.w, 0),
    height: num(doc.h, 0),
    fps: num(doc.fr, 30),
    ip,
    op: num(doc.op, ip + 1),
    images: (doc.assets ?? []).filter(
      (a) => isImageAsset(a) && typeof a.p === 'string' && a.p.startsWith('data:'),
    ).length,
  }
}

/** A part ready to be optimized. */
export function newPart(
  id: string,
  name: string,
  doc: Animation,
  source: string,
  delivered?: string,
): JobPart {
  return {
    id,
    name,
    source,
    delivered,
    info: partInfo(doc),
    result: null,
    run: null,
    verify: { status: 'pending' },
    error: null,
  }
}

function inputOf(result: OpenResult): InputFormat {
  switch (result.kind) {
    case 'dotlottie':
      return 'lottie'
    case 'tgs':
      return 'tgs'
    case 'zip':
      return 'zip'
    default:
      return 'json'
  }
}

/**
 * The file text itself can be optimized (and measured as delivered) when it is exactly the
 * animation: a plain JSON file that needed no unwrapping, repairs or embedded images.
 */
function deliveredText(
  result: OpenResult,
  opened: OpenedAnimation,
  bytes: Uint8Array,
  hadImages: boolean,
): string | undefined {
  if (result.kind !== 'json' || result.animations.length !== 1 || hadImages) return undefined
  if (opened.repairs.length) return undefined
  if (result.warnings.some((w) => w.code === 'unwrapped' || w.code === 'js-snippet'))
    return undefined
  const text = new TextDecoder().decode(bytes)
  return text.charCodeAt(0) === BOM ? text.slice(1) : text
}

/** The container written back on output; every animation is a part, so none keeps its data. */
function containerOf(result: OpenResult): DotLottieContainer | null {
  if (result.kind !== 'dotlottie' || !result.dotLottie) return null
  const container = createDotLottieContainer(result.dotLottie)
  return { ...container, animations: container.animations.map((a) => ({ id: a.id, meta: a.meta })) }
}

/** Reads a job's file (and the images dropped with it). Throws what `readLottieBytes` throws. */
export async function readJobFile(job: Pick<Job, 'file' | 'images' | 'name'>): Promise<ReadResult> {
  if (!job.file) throw new Error('The file is no longer available')
  const bytes = new Uint8Array(await job.file.arrayBuffer())
  const images: NamedBytes[] = await Promise.all(
    job.images.map(async (file) => ({
      name: file.name,
      path: file.webkitRelativePath || undefined,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  )
  await nextPaint()
  const result = readLottieBytes(bytes, job.name, { images })
  const parts = result.animations.map((opened) => {
    const delivered = deliveredText(result, opened, bytes, images.length > 0)
    const source = delivered ?? JSON.stringify(opened.data)
    return newPart(opened.id, opened.name, opened.data, source, delivered)
  })
  return {
    parts,
    container: containerOf(result),
    input: inputOf(result),
    inputSize: bytes.length,
    first: result.animations[0].data,
  }
}
