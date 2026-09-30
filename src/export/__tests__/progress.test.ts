import { describe, expect, it } from 'vitest'
import { ProgressClock, phaseProgress } from '../progress'

describe('ProgressClock', () => {
  it('reports the fraction done', () => {
    const clock = new ProgressClock(200, 0)
    expect(clock.tick(50, 100).fraction).toBe(0.25)
  })

  it('has no estimate until a few frames are done', () => {
    const clock = new ProgressClock(100, 0)
    expect(clock.tick(1, 500).secondsLeft).toBeNull()
    expect(clock.tick(2, 50).secondsLeft).toBeNull()
  })

  it('estimates the time left at a steady pace', () => {
    const clock = new ProgressClock(100, 0)
    let info = clock.tick(0, 0)
    for (let i = 1; i <= 50; i++) info = clock.tick(i, i * 20)
    // 50 frames left at 20 ms each.
    expect(info.secondsLeft).toBe(1)
    for (let i = 51; i <= 90; i++) info = clock.tick(i, 1000 + (i - 50) * 100)
    // Slowed down to 100 ms per frame: the estimate follows.
    expect(info.secondsLeft).toBeGreaterThanOrEqual(1)
    expect(info.secondsLeft).toBeLessThanOrEqual(4)
  })

  it('clamps out-of-range values', () => {
    const clock = new ProgressClock(10, 0)
    expect(clock.tick(20, 1000)).toMatchObject({ done: 10, fraction: 1, secondsLeft: 0 })
  })

  it('describes phases without frames', () => {
    expect(phaseProgress('finishing', 10, 10)).toEqual({
      phase: 'finishing',
      done: 10,
      total: 10,
      fraction: 1,
      secondsLeft: null,
    })
  })
})
