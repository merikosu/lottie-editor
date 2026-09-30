// @vitest-environment jsdom
/**
 * The queue at work, end to end (the engine runs on this thread: tests have no Web Workers; the
 * visual check, which needs a browser, is simulated): files are read, optimized, checked and
 * relaxed when the check finds a difference; settings changes re-run files; removed files stop;
 * files that cannot be read fail with a message. Plus how files get in: the file handler only
 * takes them on the optimizer page, and the editor's document becomes a job once.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Optimizer from '@/lottie/optimizer'
import type { VisualReport } from '@/lottie/optimizer'
import { BOUNCE, LIKE, visual } from './fixtures'

const checks = vi.hoisted(() => ({
  results: [] as boolean[],
  calls: 0,
}))

vi.mock('@/lottie/optimizer', async (importOriginal) => {
  const real = await importOriginal<typeof Optimizer>()
  return {
    ...real,
    // The check renders with lottie-web in a browser: here it answers from `checks.results`.
    verifyVisual: vi.fn(async (): Promise<VisualReport> => {
      checks.calls++
      const match = checks.results.length ? checks.results.shift()! : true
      return visual(match)
    }),
  }
})
vi.mock('@/features/io/thumbnail', () => ({
  renderThumbnail: vi.fn(async () => 'data:image/webp;base64,AAAA'),
  whenIdle: (task: () => void) => setTimeout(task, 0),
}))
vi.mock('@/features/io', () => ({
  describeOpenError: (_error: unknown, fileName: string) => ({
    title: `Couldn’t open “${fileName}”`,
    lines: ['This JSON is not valid.'],
  }),
}))

const { navigate } = await import('@/app/router')
const { closeDocument, loadDocument, updateDoc, useDocument } = await import('@/store/document')
const { startRunner } = await import('../model/runner')
const { addFiles, handleFiles, optimizeEditorDocument } = await import('../model/intake')
const { DEFAULT_SETTINGS, presetOptions, setOptimizerSettings, useOptimizerSettings } =
  await import('../model/settings')
const { clearJobs, removeJob, useOptimizer } = await import('../model/store')
const { jobStatus, policyFor, optionsKey } = await import('../model/summary')

const jobs = () => useOptimizer.getState().jobs
const statusOf = (index = 0) => {
  const job = jobs()[index]
  return job ? jobStatus(job, policyFor(job, useOptimizerSettings.getState())) : 'missing'
}
const file = (doc: unknown, name: string) => new File([JSON.stringify(doc)], name)
const waitDone = (index = 0) =>
  vi.waitFor(() => expect(statusOf(index)).toBe('done'), { timeout: 15_000, interval: 20 })

let stop: () => void

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
  stop = startRunner()
})
afterAll(() => {
  stop()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  clearJobs()
  setOptimizerSettings({ ...DEFAULT_SETTINGS, options: presetOptions('balanced') })
  checks.results = []
  checks.calls = 0
  navigate('optimize', { replace: true })
})
afterEach(() => clearJobs())

describe('runner', () => {
  it('reads, optimizes and checks a dropped file, and opens it when it is the only one', async () => {
    expect(addFiles([file(BOUNCE, 'bounce.json')])).toBe(true)
    expect(statusOf()).toBe('reading')
    expect(useOptimizer.getState().selectedId).toBe(jobs()[0].id)
    await waitDone()
    const job = jobs()[0]
    const r = job.parts[0].result!
    expect(r.report.after.raw).toBeLessThan(r.report.before.raw)
    expect(r.backoffs).toEqual([])
    expect(job.parts[0].verify.status).toBe('done')
    await vi.waitFor(() => expect(jobs()[0].thumbnail).toMatch(/^data:/))
  })

  it('works through several files and does not open any of them', async () => {
    addFiles([file(BOUNCE, 'a.json'), file(LIKE, 'b.json')])
    expect(useOptimizer.getState().selectedId).toBeNull()
    await waitDone(0)
    await waitDone(1)
    expect(checks.calls).toBe(2)
  })

  it('relaxes the settings until the check passes (guarantee on)', async () => {
    checks.results = [false, true]
    addFiles([file(LIKE, 'like.json')])
    await waitDone()
    const r = jobs()[0].parts[0].result!
    expect(r.backoffs).toHaveLength(1)
    expect(r.key).toBe(optionsKey(presetOptions('balanced')))
    expect(jobs()[0].parts[0].verify.visual!.match).toBe(true)
    expect(checks.calls).toBe(2)
  })

  it('keeps a differing result for review when the guarantee is off', async () => {
    setOptimizerSettings({ guarantee: false })
    checks.results = [false]
    addFiles([file(LIKE, 'like.json')])
    await waitDone()
    expect(jobs()[0].parts[0].result!.backoffs).toEqual([])
    expect(jobs()[0].parts[0].verify.visual!.match).toBe(false)
  })

  it('re-runs files after the settings change (once they settle)', async () => {
    addFiles([file(BOUNCE, 'bounce.json')])
    await waitDone()
    const balancedRaw = jobs()[0].parts[0].result!.report.after.raw
    setOptimizerSettings({ options: presetOptions('safe') })
    expect(statusOf()).toBe('queued')
    await waitDone()
    const r = jobs()[0].parts[0].result!
    expect(r.key).toBe(optionsKey(presetOptions('safe')))
    expect(r.report.after.raw).toBeGreaterThanOrEqual(balancedRaw)
  })

  it('stops the work of a removed file', async () => {
    addFiles([file(BOUNCE, 'a.json'), file(LIKE, 'b.json')])
    const first = jobs()[0].id
    removeJob(first)
    await waitDone(0)
    expect(jobs().map((j) => j.name)).toEqual(['b.json'])
  })

  it('reports files that cannot be read', async () => {
    addFiles([new File(['{ broken'], 'broken.json')])
    await vi.waitFor(() => expect(statusOf()).toBe('error'))
    expect(jobs()[0].error?.title).toContain('broken.json')
  })
})

describe('intake', () => {
  it('takes files only while the optimizer page is showing', () => {
    navigate('edit', { replace: true })
    expect(handleFiles([file(BOUNCE, 'a.json')])).toBe(false)
    navigate('optimize', { replace: true })
    expect(handleFiles([file(BOUNCE, 'a.json')])).toBe(true)
    expect(jobs()).toHaveLength(1)
  })

  it('leaves images alone (someone else explains them), but uses them with animations', () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'img_0.png', { type: 'image/png' })
    expect(addFiles([png])).toBe(false)
    expect(addFiles([file(BOUNCE, 'data.json'), png])).toBe(true)
    expect(jobs()).toHaveLength(1)
    expect(jobs()[0].images).toEqual([png])
  })

  it('sends the editor document once and shows it', async () => {
    loadDocument(BOUNCE, { fileName: 'bounce.json', format: 'json' })
    navigate('edit', { replace: true })
    optimizeEditorDocument()
    expect(jobs()).toHaveLength(1)
    expect(jobs()[0].origin.kind).toBe('editor')
    expect(useOptimizer.getState().selectedId).toBe(jobs()[0].id)
    // The same, unchanged document again: the job it already has.
    optimizeEditorDocument()
    expect(jobs()).toHaveLength(1)
    await waitDone()
    const origin = jobs()[0].origin
    expect(origin.kind === 'editor' && origin.doc === useDocument.getState().doc).toBe(true)
    closeDocument()
  })

  it('a newer version of the editor document takes the place of the older job', async () => {
    addFiles([file(LIKE, 'like.json')])
    loadDocument(BOUNCE, { fileName: 'bounce.json', format: 'json' })
    optimizeEditorDocument()
    const first = jobs()[1]
    updateDoc('Rename', (d) => {
      d.nm = 'Edited'
    })
    optimizeEditorDocument()
    // Still one entry for the editor's document, in the same place, now the current version.
    expect(jobs()).toHaveLength(2)
    expect(jobs()[0].name).toBe('like.json')
    expect(jobs()[1].id).not.toBe(first.id)
    const origin = jobs()[1].origin
    expect(origin.kind === 'editor' && origin.doc === useDocument.getState().doc).toBe(true)
    expect(useOptimizer.getState().selectedId).toBe(jobs()[1].id)
    closeDocument()
  })
})
