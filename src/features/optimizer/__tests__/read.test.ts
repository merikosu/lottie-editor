/**
 * Reading dropped files into jobs: the file text is kept for honest sizes when it is exactly the
 * animation; wrapped JSON, stickers, ZIP exports and dotLotties (several animations, themes)
 * become parts, with a container that keeps what the file carries besides the animations.
 */
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDotLottie, writeDotLottie } from '@/lottie/dotlottie'
import { LottieFileError, writeTgs } from '@/lottie/formats'
import type { Animation } from '@/lottie/types'
import { partInfo, readJobFile } from '../model/read'
import { BOUNCE, LIKE } from './fixtures'

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
})
afterEach(() => vi.unstubAllGlobals())

const read = (file: File, images: File[] = []) => readJobFile({ file, images, name: file.name })

describe('readJobFile', () => {
  it('keeps the text of a plain JSON file as delivered', async () => {
    const pretty = JSON.stringify(BOUNCE, null, 2)
    const r = await read(new File([pretty], 'bounce.json'))
    expect(r.input).toBe('json')
    expect(r.inputSize).toBe(new TextEncoder().encode(pretty).length)
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0].delivered).toBe(pretty)
    expect(r.parts[0].source).toBe(pretty)
    expect(r.container).toBeNull()
  })

  it('drops a byte order mark from the text', async () => {
    const text = `﻿${JSON.stringify(BOUNCE)}`
    const r = await read(new File([text], 'bom.json'))
    expect(r.parts[0].source.startsWith('{')).toBe(true)
    expect(() => JSON.parse(r.parts[0].source)).not.toThrow()
  })

  it('optimizes the animation, not the wrapper, of wrapped JSON', async () => {
    const r = await read(new File([JSON.stringify({ animationData: BOUNCE })], 'wrapped.json'))
    expect(r.parts[0].delivered).toBeUndefined()
    expect(JSON.parse(r.parts[0].source).layers).toHaveLength(BOUNCE.layers.length)
  })

  it('reads Telegram stickers', async () => {
    const r = await read(new File([writeTgs(BOUNCE)], 'sticker.tgs'))
    expect(r.input).toBe('tgs')
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0].delivered).toBeUndefined()
  })

  it('reads a dotLottie with several animations and keeps its container without their data', async () => {
    const bytes = writeDotLottie({
      animations: [
        { id: 'bounce', data: BOUNCE },
        { id: 'like', data: LIKE },
      ],
    })
    const r = await read(new File([bytes], 'bundle.lottie'))
    expect(r.input).toBe('lottie')
    expect(r.parts.map((p) => p.id).sort()).toEqual(['bounce', 'like'])
    expect(r.container).not.toBeNull()
    expect(r.container!.animations.every((a) => a.data === undefined)).toBe(true)
    expect(readDotLottie(bytes).animations).toHaveLength(2)
  })

  it('embeds the images of a ZIP export', async () => {
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
      0, 0,
    ])
    const withImage: Animation = {
      ...BOUNCE,
      assets: [{ id: 'img_0', w: 1, h: 1, u: 'images/', p: 'img_0.png', e: 0 }],
    }
    const zip = zipSync({
      'data.json': strToU8(JSON.stringify(withImage)),
      'images/img_0.png': png,
    })
    const r = await read(new File([zip], 'export.zip'))
    expect(r.input).toBe('zip')
    const asset = JSON.parse(r.parts[0].source).assets[0]
    expect(asset.p.startsWith('data:image/png;base64,')).toBe(true)
    expect(r.parts[0].info.images).toBe(1)
  })

  it('throws what the reader throws for files that are not animations', async () => {
    await expect(read(new File(['{ "a": 1 }'], 'data.json'))).rejects.toBeInstanceOf(
      LottieFileError,
    )
    await expect(read(new File(['{ broken'], 'broken.json'))).rejects.toBeInstanceOf(
      LottieFileError,
    )
    await expect(read(new File([''], 'empty.json'))).rejects.toBeInstanceOf(LottieFileError)
  })
})

describe('partInfo', () => {
  it('reads size, rate and duration with fallbacks', () => {
    expect(partInfo(BOUNCE)).toMatchObject({
      width: 512,
      height: 512,
      fps: 30,
      ip: 0,
      op: 60,
      images: 0,
    })
    const odd = { ...BOUNCE, fr: Number.NaN, op: undefined } as unknown as Animation
    expect(partInfo(odd)).toMatchObject({ fps: 30, op: 1 })
  })
})
