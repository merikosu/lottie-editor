/**
 * The files the optimizer hands out: names, exact sizes, every format (JSON, .tgs, .lottie with
 * the container's themes and other animations), caching, and the ZIP of all files.
 */
import { gunzipSync, strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createDotLottieContainer, readDotLottie, writeDotLottie } from '@/lottie/dotlottie'
import {
  buildArchive,
  buildOutput,
  canBeSticker,
  hasOutput,
  knownSize,
  outputName,
  pruneOutputs,
  uniqueNames,
} from '../model/output'
import { BOUNCE, LIKE, donePart, job, part } from './fixtures'

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

describe('names', () => {
  it('keeps the input name with the output extension', () => {
    expect(outputName({ name: 'loader.json' }, 'lottie')).toBe('loader.lottie')
    expect(outputName({ name: 'sticker.tgs' }, 'tgs')).toBe('sticker.tgs')
    expect(outputName({ name: 'export.zip' }, 'json')).toBe('export.json')
    expect(outputName({ name: 'a:b?.json' }, 'json')).toBe('a-b-.json')
    expect(outputName({ name: 'bundle.lottie' }, 'json', 'like')).toBe('bundle-like.json')
  })

  it('makes archive names unique, case-insensitively', () => {
    expect(uniqueNames(['a.json', 'A.json', 'a.json', 'b.lottie'])).toEqual([
      'a.json',
      'A (2).json',
      'a (3).json',
      'b.lottie',
    ])
  })
})

describe('buildOutput', () => {
  it('writes the optimized JSON with its exact size', async () => {
    const j = job({ parts: [await donePart(BOUNCE)] })
    const out = buildOutput(j, 'json')
    expect(out.fileName).toBe(j.name)
    expect(out.size).toBe(j.parts[0].result!.report.after.raw)
    expect(knownSize(j, 'json')).toBe(out.size)
    expect(JSON.parse(strFromU8(await bytesOf(out.blob)))).toEqual(
      JSON.parse(j.parts[0].result!.json),
    )
  })

  it('writes a Telegram sticker whose size is the reported gzip size', async () => {
    const j = job({ name: 'sticker.tgs', input: 'tgs', parts: [await donePart(BOUNCE)] })
    const out = buildOutput(j, 'tgs')
    expect(out.fileName).toBe('sticker.tgs')
    expect(out.size).toBe(knownSize(j, 'tgs'))
    expect(strFromU8(gunzipSync(await bytesOf(out.blob)))).toBe(j.parts[0].result!.json)
  })

  it('writes a .lottie of a JSON file', async () => {
    const j = job({ name: 'bounce.json', parts: [await donePart(BOUNCE)] })
    const out = buildOutput(j, 'lottie')
    expect(out.fileName).toBe('bounce.lottie')
    const file = readDotLottie(await bytesOf(out.blob))
    expect(file.animations).toHaveLength(1)
    expect(file.animations[0].data.layers.length).toBe(BOUNCE.layers.length)
    expect(knownSize(j, 'lottie')).toBeNull()
  })

  it('writes every animation of a dotLottie back with its themes', async () => {
    const source = readDotLottie(
      writeDotLottie({
        animations: [
          { id: 'bounce', data: BOUNCE },
          { id: 'like', data: LIKE },
        ],
        container: {
          ...createDotLottieContainer(
            readDotLottie(writeDotLottie({ animations: [{ id: 'bounce', data: BOUNCE }] })),
          ),
          themes: [{ id: 'dark', data: { rules: [] } }],
          version: 2,
        },
      }),
    )
    expect(source.themes).toHaveLength(1)
    const container = createDotLottieContainer(source)
    const j = job({
      name: 'bundle.lottie',
      input: 'lottie',
      container: {
        ...container,
        animations: container.animations.map((a) => ({ id: a.id, meta: a.meta })),
      },
      parts: [
        { ...(await donePart(BOUNCE)), id: 'bounce' },
        { ...(await donePart(LIKE)), id: 'like' },
      ],
    })
    const out = buildOutput(j, 'lottie')
    const written = readDotLottie(await bytesOf(out.blob))
    expect(written.animations.map((a) => a.id).sort()).toEqual(['bounce', 'like'])
    expect(written.themes.map((t) => t.id)).toEqual(['dark'])
    // Each animation is the optimized one.
    const like = written.animations.find((a) => a.id === 'like')!
    expect(JSON.stringify(like.data).length).toBeLessThan(JSON.stringify(LIKE).length)
    // JSON of one animation of the file is named after it.
    expect(buildOutput(j, 'json', 1).fileName).toBe('bundle-like.json')
  })

  it('caches files per result and forgets removed jobs', async () => {
    const j = job({ parts: [await donePart(BOUNCE)] })
    const a = buildOutput(j, 'lottie')
    expect(buildOutput(j, 'lottie')).toBe(a)
    // A new result (re-run) builds a new file.
    const rerun = { ...j, parts: [{ ...j.parts[0], result: { ...j.parts[0].result! } }] }
    expect(buildOutput(rerun, 'lottie')).not.toBe(a)
    pruneOutputs(new Set())
    expect(buildOutput(rerun, 'lottie')).not.toBe(a)
  })

  it('refuses to write a file that has not been optimized', () => {
    const j = job({ parts: [part()] })
    expect(hasOutput(j)).toBe(false)
    expect(() => buildOutput(j, 'json')).toThrow()
  })
})

describe('canBeSticker', () => {
  it('keeps stickers stickers and never offers one for several animations or no result', async () => {
    const done = await donePart(BOUNCE)
    expect(canBeSticker(job({ input: 'tgs', parts: [done] }))).toBe(true)
    expect(canBeSticker(job({ parts: [done, await donePart(LIKE)] }))).toBe(false)
    expect(canBeSticker(job({ parts: [part()] }))).toBe(false)
    // Decided by the sticker rules (size, frame rate, features) and remembered per result.
    const plain = job({ parts: [done] })
    expect(canBeSticker(plain)).toBe(canBeSticker(plain))
  })
})

describe('buildArchive', () => {
  it('zips every optimized file in the chosen format with unique names', async () => {
    const a = job({ name: 'anim.json', parts: [await donePart(BOUNCE)] })
    const b = job({ name: 'anim.json', input: 'tgs', parts: [await donePart(LIKE)] })
    const pending = job({ name: 'later.json', parts: [part()] })
    const zip = await buildArchive([a, b, pending], 'same')
    const files = unzipSync(await bytesOf(zip!))
    expect(Object.keys(files).sort()).toEqual(['anim.json', 'anim.tgs'])
    const lotties = unzipSync(await bytesOf((await buildArchive([a, b], 'lottie'))!))
    expect(Object.keys(lotties).sort()).toEqual(['anim (2).lottie', 'anim.lottie'])
    expect(await buildArchive([pending], 'same')).toBeNull()
  })
})
