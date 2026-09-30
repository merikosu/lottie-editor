import { describe, expect, it } from 'vitest'
import { planTiming } from '../plan'

describe('planTiming', () => {
  const doc = { fr: 60, ip: 0, op: 179 }

  it('keeps the speed when the frame rate changes with the duration kept', () => {
    // 179 frames at 60 fps = 71.6 frames at 24 fps: the out point is rounded, the speed is not.
    const plan = planTiming(doc, 24, true, 1)
    expect(plan.base).toMatchObject({ ip: 0, op: 72 })
    expect(plan.frames).toBe(72)
    expect(plan.speedFactor).toBe(1)
  })

  it('plays the same frames faster or slower without keeping the duration', () => {
    const plan = planTiming(doc, 30, false, 1)
    expect(plan.frames).toBe(179)
    expect(plan.speedFactor).toBe(0.5)
  })

  it('retimes on top of the frame rate change', () => {
    const slower = planTiming(doc, 24, true, 0.5)
    expect(slower.frames).toBe(144)
    expect(slower.speedFactor).toBe(0.5)
    const faster = planTiming({ fr: 30, ip: 10, op: 70 }, 30, true, 1.5)
    expect(faster.base).toMatchObject({ ip: 10, op: 70 })
    expect(faster.frames).toBe(40)
    expect(faster.speedFactor).toBe(1.5)
  })

  it('never plans an empty animation', () => {
    expect(planTiming(doc, 60, true, 1e6).frames).toBe(1)
    expect(planTiming(doc, 60, true, 0).frames).toBe(179)
  })
})
