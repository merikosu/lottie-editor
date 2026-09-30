/**
 * Minimal readers for the binary files the export writes: enough to tell a real PNG, GIF, WebM
 * or MP4 file from a broken one and to read its size and frame count.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Size of a PNG image, or null when the bytes are not a PNG. */
export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  const b = Buffer.from(buf)
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (b.subarray(12, 16).toString('latin1') !== 'IHDR') return null
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

export interface GifInfo {
  width: number
  height: number
  frames: number
  /** NETSCAPE2.0 loop count (0 = forever), null without the extension (plays once). */
  loops: number | null
}

/** Bytes of the color table announced by a GIF packed-fields byte (0 without one). */
function colorTableSize(flags: number): number {
  return flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0
}

/** Walks the blocks of a GIF file; null when the bytes are not a well-formed GIF. */
export function gifInfo(buf: Uint8Array): GifInfo | null {
  const b = Buffer.from(buf)
  const header = b.subarray(0, 6).toString('latin1')
  if (header !== 'GIF89a' && header !== 'GIF87a') return null
  const info: GifInfo = {
    width: b.readUInt16LE(6),
    height: b.readUInt16LE(8),
    frames: 0,
    loops: null,
  }
  let i = 13 + colorTableSize(b[10])
  const skipSubBlocks = () => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1
    i++ // block terminator
  }
  while (i < b.length) {
    const block = b[i]
    if (block === 0x3b) return info // trailer
    if (block === 0x21) {
      const label = b[i + 1]
      const app = b.subarray(i + 3, i + 14).toString('latin1')
      if (label === 0xff && app === 'NETSCAPE2.0') info.loops = b.readUInt16LE(i + 16)
      i += 2
      skipSubBlocks()
    } else if (block === 0x2c) {
      info.frames++
      i += 10 + colorTableSize(b[i + 9]) + 1 // descriptor, local color table, LZW minimum code size
      skipSubBlocks()
    } else {
      return null
    }
  }
  return null // no trailer: truncated
}

/** True for a WebM file (an EBML document of type "webm"). */
export function isWebm(buf: Uint8Array): boolean {
  const b = Buffer.from(buf)
  return b.readUInt32BE(0) === 0x1a45dfa3 && b.subarray(0, 64).includes('webm', 0, 'latin1')
}

/** True for an MP4 / ISO BMFF file (starts with an `ftyp` box). */
export function isMp4(buf: Uint8Array): boolean {
  return Buffer.from(buf).subarray(4, 8).toString('latin1') === 'ftyp'
}
