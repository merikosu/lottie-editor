/**
 * Minimal GIF decoder for tests: parses blocks, decodes LZW and composites frames with their
 * disposal methods, so encoder output can be checked pixel by pixel.
 */

export interface DecodedFrame {
  left: number
  top: number
  width: number
  height: number
  /** Centiseconds. */
  delay: number
  disposal: number
  /** -1 when the frame has no transparent color. */
  transparentIndex: number
  /** Local color table, if any. */
  localPalette: number[][] | null
  indices: Uint8Array
}

export interface DecodedGif {
  width: number
  height: number
  globalPalette: number[][] | null
  /** NETSCAPE2.0 loop count; null when the extension is absent (plays once). */
  loopCount: number | null
  frames: DecodedFrame[]
}

function readPalette(bytes: Uint8Array, offset: number, size: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < size; i++)
    out.push([bytes[offset + i * 3], bytes[offset + i * 3 + 1], bytes[offset + i * 3 + 2]])
  return out
}

function lzwDecode(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  let dict: number[][] = []
  const reset = () => {
    dict = []
    for (let i = 0; i < clear; i++) dict[i] = [i]
    dict[clear] = []
    dict[eoi] = []
  }
  reset()
  let codeSize = minCodeSize + 1
  let prev: number[] | null = null
  const out: number[] = []
  let bitPos = 0
  const totalBits = data.length * 8
  while (bitPos + codeSize <= totalBits && out.length < pixelCount) {
    let code = 0
    for (let i = 0; i < codeSize; i++) {
      const bit = (data[bitPos >> 3] >> (bitPos & 7)) & 1
      code |= bit << i
      bitPos++
    }
    if (code === clear) {
      reset()
      codeSize = minCodeSize + 1
      prev = null
      continue
    }
    if (code === eoi) break
    let entry: number[]
    if (code < dict.length) entry = dict[code]
    else if (code === dict.length && prev) entry = [...prev, prev[0]]
    else throw new Error(`Invalid LZW code ${code}`)
    for (const v of entry) out.push(v)
    if (prev) dict.push([...prev, entry[0]])
    prev = entry
    if (dict.length === 1 << codeSize && codeSize < 12) codeSize++
  }
  return Uint8Array.from(out.slice(0, pixelCount))
}

function readSubBlocks(bytes: Uint8Array, offset: number): { data: Uint8Array; next: number } {
  const chunks: number[] = []
  let pos = offset
  for (;;) {
    const size = bytes[pos++]
    if (size === 0) break
    for (let i = 0; i < size; i++) chunks.push(bytes[pos + i])
    pos += size
  }
  return { data: Uint8Array.from(chunks), next: pos }
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  const sig = String.fromCharCode(...bytes.subarray(0, 6))
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('Not a GIF')
  const u16 = (o: number) => bytes[o] | (bytes[o + 1] << 8)
  const width = u16(6)
  const height = u16(8)
  const packed = bytes[10]
  let pos = 13
  let globalPalette: number[][] | null = null
  if (packed & 0x80) {
    const size = 1 << ((packed & 7) + 1)
    globalPalette = readPalette(bytes, pos, size)
    pos += size * 3
  }
  let loopCount: number | null = null
  const frames: DecodedFrame[] = []
  let gce = { delay: 0, disposal: 0, transparentIndex: -1 }
  while (pos < bytes.length) {
    const block = bytes[pos++]
    if (block === 0x3b) break
    if (block === 0x21) {
      const label = bytes[pos++]
      if (label === 0xf9) {
        const p = bytes[pos + 1]
        gce = {
          delay: u16(pos + 2),
          disposal: (p >> 2) & 7,
          transparentIndex: p & 1 ? bytes[pos + 4] : -1,
        }
        pos += 6
      } else if (label === 0xff) {
        const size = bytes[pos]
        const id = String.fromCharCode(...bytes.subarray(pos + 1, pos + 1 + size))
        const sub = readSubBlocks(bytes, pos + 1 + size)
        if (id === 'NETSCAPE2.0' && sub.data[0] === 1) loopCount = sub.data[1] | (sub.data[2] << 8)
        pos = sub.next
      } else {
        pos = readSubBlocks(bytes, pos).next
      }
    } else if (block === 0x2c) {
      const left = u16(pos)
      const top = u16(pos + 2)
      const w = u16(pos + 4)
      const h = u16(pos + 6)
      const p = bytes[pos + 8]
      pos += 9
      let localPalette: number[][] | null = null
      if (p & 0x80) {
        const size = 1 << ((p & 7) + 1)
        localPalette = readPalette(bytes, pos, size)
        pos += size * 3
      }
      const minCodeSize = bytes[pos++]
      const sub = readSubBlocks(bytes, pos)
      pos = sub.next
      frames.push({
        left,
        top,
        width: w,
        height: h,
        ...gce,
        localPalette,
        indices: lzwDecode(minCodeSize, sub.data, w * h),
      })
      gce = { delay: 0, disposal: 0, transparentIndex: -1 }
    } else {
      throw new Error(`Unexpected block 0x${block.toString(16)} at ${pos - 1}`)
    }
  }
  return { width, height, globalPalette, loopCount, frames }
}

/** RGBA of every frame as a viewer shows it (transparent pixels keep what was below). */
export function compositeFrames(gif: DecodedGif): Uint8ClampedArray[] {
  const screen = new Uint8ClampedArray(gif.width * gif.height * 4)
  const out: Uint8ClampedArray[] = []
  for (const f of gif.frames) {
    const palette = f.localPalette ?? gif.globalPalette ?? []
    const saved = f.disposal === 3 ? screen.slice() : null
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        const idx = f.indices[y * f.width + x]
        if (idx === f.transparentIndex) continue
        const c = palette[idx] ?? [0, 0, 0]
        const p = ((f.top + y) * gif.width + f.left + x) * 4
        screen[p] = c[0]
        screen[p + 1] = c[1]
        screen[p + 2] = c[2]
        screen[p + 3] = 255
      }
    }
    out.push(screen.slice())
    if (f.disposal === 2) {
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++)
          screen.fill(
            0,
            ((f.top + y) * gif.width + f.left + x) * 4,
            ((f.top + y) * gif.width + f.left + x) * 4 + 4,
          )
      }
    } else if (saved) {
      screen.set(saved)
    }
  }
  return out
}
