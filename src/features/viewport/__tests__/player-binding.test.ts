import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animation } from '@/lottie/types'

/* ------------------------------ Test doubles ------------------------------ */

type Anim = { id: number }

interface FakeOptions {
  onError?: (error: Error) => void
  onReady?: () => void
}

/** Stand-in for LottiePlayer: records loads; the test drives readiness and failures. */
class FakePlayer {
  static last: FakePlayer
  loads: Animation[] = []
  animation: Anim | null = null
  pending: Anim | null = null
  opts: FakeOptions
  renderer = 'svg'
  /** What the next load does: 'ready' (sync swap), 'fail-build' (error, never ready), 'fail-render' (error, then swapped in). */
  behavior: 'ready' | 'fail-build' | 'fail-render' | 'throw' = 'ready'
  /** Simulated duration of a load (ms of fake time). */
  cost = 0
  private nextId = 1

  constructor(_host: unknown, opts: FakeOptions) {
    this.opts = opts
    FakePlayer.last = this
  }
  setOptions() {}
  renderFrame() {}
  destroy() {}
  load(doc: Animation) {
    this.loads.push(doc)
    // The binding measures load time; nothing of its own is scheduled while it loads.
    if (this.cost) vi.advanceTimersByTime(this.cost)
    const anim = { id: this.nextId++ }
    if (this.behavior === 'throw') {
      this.opts.onError?.(new Error('thrown'))
      return
    }
    this.pending = anim
    if (this.behavior === 'fail-build') {
      route?.(anim, new Error('build failed'))
      return
    }
    if (this.behavior === 'fail-render') route?.(anim, new Error('render failed'))
    // lottie is ready synchronously without fonts: the instance is swapped in right away.
    this.animation = anim
    this.pending = null
    this.opts.onReady?.()
  }
}

let route: ((anim: Anim, error: Error) => void) | null = null

vi.mock('@/player/LottiePlayer', () => ({ LottiePlayer: FakePlayer }))
vi.mock('../lottie-errors', () => ({
  routeLottieErrors: (_root: unknown, listener: (anim: Anim, error: Error) => void) => {
    route = listener
    return () => {
      route = null
    }
  },
}))

const { PlayerBinding } = await import('../player-binding')

/* --------------------------------- Setup --------------------------------- */

let docCount = 0
/** A document that renders differently from every other one (its duration differs). */
const doc = (name: string) =>
  ({ nm: name, v: '5', fr: 30, ip: 0, op: ++docCount, w: 1, h: 1, layers: [] }) as Animation

function setup() {
  const ready: boolean[] = []
  const errors: string[] = []
  const binding = new PlayerBinding({
    host: {} as HTMLElement,
    renderer: 'svg',
    runExpressions: false,
    interactive: true,
    onReady: (clean) => ready.push(clean),
    onError: (error) => errors.push(error.message),
  })
  return { binding, player: FakePlayer.last, ready, errors }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  let raf = 0
  const frames = new Map<number, ReturnType<typeof setTimeout>>()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++raf
    frames.set(
      id,
      setTimeout(() => cb(performance.now()), 16),
    )
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(frames.get(id)))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/* --------------------------------- Tests --------------------------------- */

describe('PlayerBinding loads', () => {
  it('loads immediately when asked', () => {
    const { binding, player, ready } = setup()
    const a = doc('a')
    binding.request(a, true)
    expect(player.loads).toEqual([a])
    expect(ready).toEqual([true])
  })

  it('coalesces a burst of edits into one load of the latest document', () => {
    const { binding, player } = setup()
    const docs = [doc('1'), doc('2'), doc('3')]
    for (const d of docs) binding.request(d)
    expect(player.loads).toHaveLength(0)
    vi.advanceTimersByTime(20)
    expect(player.loads).toEqual([docs[2]])
  })

  it('throttles further loads to the minimum interval with a trailing load', () => {
    const { binding, player } = setup()
    binding.request(doc('first'), true)
    const later = [doc('a'), doc('b')]
    binding.request(later[0])
    vi.advanceTimersByTime(10)
    binding.request(later[1])
    expect(player.loads).toHaveLength(1)
    vi.advanceTimersByTime(60)
    expect(player.loads.slice(1)).toEqual([later[1]])
  })

  it('keeps the player for edits that render the same (names, markers)', () => {
    const { binding, player } = setup()
    const a = doc('a')
    binding.request(a, true)
    const renamed = { ...a, nm: 'renamed', markers: [{ cm: 'M', tm: 0 }] } as Animation
    binding.request(renamed)
    vi.advanceTimersByTime(100)
    expect(player.loads).toEqual([a])
    // A visual change after it still loads (compared with what is shown).
    const moved = { ...renamed, w: 2 }
    binding.request(moved)
    vi.advanceTimersByTime(100)
    expect(player.loads).toEqual([a, moved])
    // Asked explicitly: always loads.
    binding.request({ ...moved, nm: 'x' }, true)
    expect(player.loads).toHaveLength(3)
  })

  it('lets heavy documents wait for the end of a gesture', () => {
    const { binding, player } = setup()
    player.cost = 200
    binding.request(doc('first'), true)
    const steps = [doc('1'), doc('2'), doc('3'), doc('4')]
    for (const d of steps) {
      binding.request(d, false, undefined, true)
      vi.advanceTimersByTime(250)
    }
    // No load freezes the drag while it runs, even with pauses between steps…
    expect(player.loads).toHaveLength(1)
    // …the latest document loads right after the pointer is released.
    binding.endGesture()
    vi.advanceTimersByTime(20)
    expect(player.loads).toEqual([expect.anything(), steps[3]])
    // Nothing pending: another release does nothing.
    binding.endGesture()
    vi.advanceTimersByTime(20)
    expect(player.loads).toHaveLength(2)
  })

  it('still shows progress during long heavy gestures (maximum wait)', () => {
    const { binding, player } = setup()
    player.cost = 200
    binding.request(doc('first'), true)
    for (let i = 0; i < 40; i++) {
      binding.request(doc(`step ${i}`), false, undefined, true)
      vi.advanceTimersByTime(40)
    }
    // 1.6 s of steady dragging: one intermediate load, not one per step.
    expect(player.loads).toHaveLength(2)
  })

  it('a discrete edit after a deferred gesture loads without waiting', () => {
    const { binding, player } = setup()
    player.cost = 200
    binding.request(doc('first'), true)
    binding.request(doc('drag step'), false, undefined, true)
    const final = doc('final')
    binding.request(final)
    // The usual throttle applies (2 × load time since the last load), not the gesture's wait.
    vi.advanceTimersByTime(450)
    expect(player.loads.at(-1)).toBe(final)
  })

  it('drops a deferred load when the document comes back to what is shown', () => {
    const { binding, player } = setup()
    player.cost = 200
    const first = doc('first')
    binding.request(first, true)
    binding.request(doc('drag step'), false, undefined, true)
    // Esc: the document is restored (an equal copy) before anything loaded.
    binding.request({ ...first })
    binding.endGesture()
    vi.advanceTimersByTime(2000)
    expect(player.loads).toEqual([first])
  })

  it('restores after a cancelled preview only when the player left the document', () => {
    const { binding, player } = setup()
    player.cost = 200
    const base = doc('base')
    binding.request(base, true)
    // Heavy: the preview was deferred and never shown; Esc needs no reload.
    binding.request(doc('preview'), false, undefined, true)
    binding.restore(base)
    vi.advanceTimersByTime(2000)
    expect(player.loads).toEqual([base])
    // Light: the preview is on screen; Esc brings the document back at once.
    player.cost = 0
    const light = doc('light')
    binding.request(light, true)
    binding.request(doc('light preview'), true)
    binding.restore(light)
    expect(player.loads.at(-1)).toBe(light)
  })

  it('keeps light documents live during gestures', () => {
    const { binding, player } = setup()
    binding.request(doc('first'), true)
    for (let i = 0; i < 5; i++) {
      binding.request(doc(`step ${i}`), false, undefined, true)
      vi.advanceTimersByTime(60)
    }
    expect(player.loads).toHaveLength(6)
  })

  it('reloads renames while expressions run (they may read layer names)', () => {
    const { binding, player } = setup()
    const a = doc('a')
    binding.request(a, true)
    binding.configure({ runExpressions: true }, false)
    const renamed = { ...a, nm: 'renamed' }
    binding.request(renamed)
    vi.advanceTimersByTime(100)
    expect(player.loads).toEqual([a, renamed])
  })

  it('skips documents that are already loaded, reloads on demand', () => {
    const { binding, player } = setup()
    const a = doc('a')
    binding.request(a, true)
    binding.request(a, true)
    expect(player.loads).toHaveLength(1)
    binding.reload()
    expect(player.loads).toEqual([a, a])
  })
})

describe('PlayerBinding errors', () => {
  it('restores the last good document when a new build fails', async () => {
    const { binding, player, ready, errors } = setup()
    const good = doc('good')
    const bad = doc('bad')
    binding.request(good, true)
    player.behavior = 'fail-build'
    binding.request(bad, true)
    expect(errors).toEqual(['build failed'])
    player.behavior = 'ready'
    await Promise.resolve()
    expect(player.loads).toEqual([good, bad, good])
    // The restored document renders, but the current one is still broken.
    expect(ready).toEqual([true, false])
  })

  it('restores the last good document when a broken instance was swapped in', async () => {
    const { binding, player, ready } = setup()
    const good = doc('good')
    binding.request(good, true)
    player.behavior = 'fail-render'
    binding.request(doc('bad'), true)
    expect(ready).toEqual([true, false])
    player.behavior = 'ready'
    await Promise.resolve()
    expect(player.loads.at(-1)).toBe(good)
    expect(ready).toEqual([true, false, false])
  })

  it('a fixed document clears the error state (clean ready)', async () => {
    const { binding, player, ready } = setup()
    binding.request(doc('good'), true)
    player.behavior = 'fail-build'
    binding.request(doc('bad'), true)
    player.behavior = 'ready'
    await Promise.resolve()
    binding.request(doc('fixed'), true)
    expect(ready.at(-1)).toBe(true)
  })

  it('does not loop when the restore fails too', async () => {
    const { binding, player } = setup()
    binding.request(doc('good'), true)
    player.behavior = 'fail-build'
    binding.request(doc('bad'), true)
    await Promise.resolve()
    await Promise.resolve()
    expect(player.loads).toHaveLength(3)
  })

  it('never restores a previous file after forgetLastGood (new document)', async () => {
    const { binding, player } = setup()
    binding.request(doc('previous file'), true)
    binding.forgetLastGood()
    player.behavior = 'fail-build'
    binding.request(doc('new file'), true)
    await Promise.resolve()
    expect(player.loads).toHaveLength(2)
  })

  it('reports failures of the instance on screen without reloading', async () => {
    const { binding, player, errors } = setup()
    binding.request(doc('good'), true)
    route?.(player.animation as Anim, new Error('frame 42 failed'))
    await Promise.resolve()
    expect(errors).toEqual(['frame 42 failed'])
    expect(player.loads).toHaveLength(1)
  })

  it('failures thrown before an instance exists keep the old one', async () => {
    const { binding, player, errors } = setup()
    binding.request(doc('good'), true)
    player.behavior = 'throw'
    binding.request(doc('bad'), true)
    await Promise.resolve()
    expect(errors).toEqual(['thrown'])
    expect(player.loads).toHaveLength(2)
  })
})
