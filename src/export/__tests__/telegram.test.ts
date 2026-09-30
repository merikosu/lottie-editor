import { describe, expect, it } from 'vitest'
import { encodeTgs } from '../lottie-files'
import { TGS_FEATURES, checkTelegram, type TgsCheckId } from '../telegram'
import { forbiddenFeatures, loadBounce, loadTestJson } from './fixtures'

const statusOf = (report: ReturnType<typeof checkTelegram>, id: TgsCheckId) =>
  report.checks.find((c) => c.id === id)!

describe('checkTelegram', () => {
  it('lists every rule once', () => {
    const report = checkTelegram(loadBounce(), 1000)
    const ids = report.checks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['size', 'fps', 'duration', 'fileSize', ...TGS_FEATURES])
  })

  it('checks size, frame rate, length and file size', () => {
    const doc = loadBounce() // 512 × 512, 30 fps, 2 s
    const report = checkTelegram(doc, 70_000)
    expect(statusOf(report, 'size').status).toBe('pass')
    expect(statusOf(report, 'fps').status).toBe('fail')
    expect(statusOf(report, 'duration').status).toBe('pass')
    expect(statusOf(report, 'fileSize').status).toBe('fail')
    expect(statusOf(checkTelegram(doc, 65_536), 'fileSize').status).toBe('pass')
    expect(statusOf(checkTelegram(doc, null), 'fileSize').status).toBe('pending')
  })

  it('finds every forbidden feature, in precomps too', () => {
    const report = checkTelegram(forbiddenFeatures(), 100)
    for (const id of TGS_FEATURES) expect(statusOf(report, id).status, id).toBe('fail')
    expect(statusOf(report, 'expressions').layers).toEqual(['Shapes'])
    expect(statusOf(report, 'images').count).toBe(1)
    expect(report.failures).toBeGreaterThanOrEqual(TGS_FEATURES.length)
  })

  it('counts unused image assets as images', () => {
    const doc = loadBounce()
    doc.assets = [{ id: 'unused', w: 1, h: 1, p: 'data:image/png;base64,AAAA', e: 1 }]
    expect(statusOf(checkTelegram(doc, 10), 'images')).toMatchObject({
      status: 'fail',
      layers: ['unused'],
    })
  })

  it('passes a clean sticker', () => {
    const doc = loadBounce()
    doc.fr = 60
    doc.op = 120
    const report = checkTelegram(doc, 1000)
    expect(report.failures).toBe(0)
  })

  it('reports the real-world sticker', () => {
    const doc = loadTestJson()
    const report = checkTelegram(doc, encodeTgs(doc).length)
    expect(statusOf(report, 'size').status).toBe('pass')
    expect(statusOf(report, 'fps').status).toBe('pass')
    expect(statusOf(report, 'duration').status).toBe('pass')
    expect(statusOf(report, 'fileSize').status).toBe('pass')
    expect(statusOf(report, 'effects').status).toBe('fail')
    expect(statusOf(report, 'expressions').status).toBe('fail')
  })
})
