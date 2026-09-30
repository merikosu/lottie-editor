/**
 * PNG sequence in a ZIP archive.
 *
 * PNGs are already compressed, so entries are stored (no second deflate) and only CRCs are
 * computed here. Encoding overlaps with rendering: `toBlob` snapshots the canvas immediately
 * and encodes in the background, a few frames are kept in flight, and entries are written in
 * frame order.
 */
import { Zip, ZipPassThrough } from 'fflate'
import { frameFileName } from './plan'
import { canvasToBlob } from './render'

export interface PngSequenceOptions {
  frameCount: number
  /** File name stem of each frame ("bounce" → bounce_0000.png). */
  baseName: string
  canvas: HTMLCanvasElement
  renderFrame: (index: number) => Promise<void>
  onFrame?: (done: number) => void
  yieldNow?: () => Promise<void>
  signal?: AbortSignal
}

const IN_FLIGHT = 4

export async function encodePngSequence(o: PngSequenceOptions): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  let failure: unknown = null
  const zip = new Zip((err, chunk) => {
    if (err) failure = err
    else parts.push(chunk as Uint8Array<ArrayBuffer>)
  })
  const mtime = new Date()
  const pending: { index: number; bytes: Promise<Uint8Array> }[] = []
  let written = 0

  const writeOldest = async () => {
    const next = pending.shift()
    if (!next) return
    const bytes = await next.bytes
    const entry = new ZipPassThrough(frameFileName(o.baseName, next.index, o.frameCount))
    entry.mtime = mtime
    zip.add(entry)
    entry.push(bytes, true)
    if (failure) throw failure
    written++
    o.onFrame?.(written)
  }

  try {
    for (let i = 0; i < o.frameCount; i++) {
      o.signal?.throwIfAborted()
      await o.renderFrame(i)
      pending.push({
        index: i,
        bytes: canvasToBlob(o.canvas).then(
          async (blob) => new Uint8Array(await blob.arrayBuffer()),
        ),
      })
      if (pending.length >= IN_FLIGHT) await writeOldest()
      await o.yieldNow?.()
    }
    while (pending.length) {
      o.signal?.throwIfAborted()
      await writeOldest()
    }
    zip.end()
    if (failure) throw failure
  } catch (err) {
    zip.terminate()
    // Let in-flight encodes settle quietly.
    await Promise.allSettled(pending.map((p) => p.bytes))
    throw err
  }
  return new Blob(parts, { type: 'application/zip' })
}
