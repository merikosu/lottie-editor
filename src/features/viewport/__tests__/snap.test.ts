import { describe, expect, it } from 'vitest'
import { artboardLines, mergeLines, rectLines, snapOffset } from '../lib/snap'

const lines = artboardLines(512, 256)
const box = { x: 100, y: 50, width: 40, height: 20 }

describe('snapOffset', () => {
  it('leaves drags away from the lines alone', () => {
    const r = snapOffset(box, { x: 30, y: 30 }, lines, 5)
    expect(r.offset).toEqual({ x: 30, y: 30 })
    expect(r.guides).toEqual({ x: null, y: null })
  })

  it('snaps the center to the artboard center', () => {
    // Center x = 120 + dx; 256 is the artboard center: dx 134 → 2 px away.
    const r = snapOffset(box, { x: 134, y: 0 }, lines, 5)
    expect(r.offset.x).toBe(136)
    // The guide spans the artboard (and the dragged box).
    expect(r.guides.x).toEqual({ at: 256, from: 0, to: 256 })
  })

  it('snaps edges to edges and picks the nearest line', () => {
    // Left edge 100 + dx → 0 when dx = -100 (3 px away); the right edge is far from 512.
    const r = snapOffset(box, { x: -97, y: 184 }, lines, 5)
    expect(r.offset).toEqual({ x: -100, y: 186 })
    expect(r.guides.x?.at).toBe(0)
    expect(r.guides.y?.at).toBe(256)
  })

  it('does not snap or move a locked axis', () => {
    const r = snapOffset(box, { x: 134, y: 0 }, lines, 5, 'x')
    expect(r.offset.x).toBe(134)
    expect(r.guides.x).toBeNull()
  })

  it('snaps points (zero-size bounds, e.g. a null layer anchor)', () => {
    const r = snapOffset({ x: 10, y: 10, width: 0, height: 0 }, { x: 244, y: 117 }, lines, 5)
    expect(r.offset).toEqual({ x: 246, y: 118 })
  })
})

describe('snapping to objects', () => {
  // Another object at x 300…340, y 200…260 (far from the artboard lines used below).
  const other = { x: 300, y: 200, width: 40, height: 60 }
  const all = mergeLines(artboardLines(1000, 1000), rectLines([other]))

  it('lists edges and centers of objects with their extents', () => {
    const r = rectLines([other])
    expect(r.x.map((l) => l.at)).toEqual([300, 320, 340])
    expect(r.x[0]).toEqual({ at: 300, from: 200, to: 260 })
    expect(r.y.map((l) => l.at)).toEqual([200, 230, 260])
    expect(r.y[2]).toEqual({ at: 260, from: 300, to: 340 })
  })

  it('aligns an edge with an object edge; the guide spans both', () => {
    // Box left edge 100 + dx; object left 300: dx 198 → 2 px away. Box moves to y 50 + 60.
    const r = snapOffset(box, { x: 198, y: 60 }, all, 5)
    expect(r.offset.x).toBe(200)
    expect(r.guides.x).toEqual({ at: 300, from: 110, to: 260 })
  })

  it('aligns centers, and prefers the nearest line', () => {
    // Box middle y = 60 + dy; object middle 230: dy 171 → 1 px away (top 200 is 11 px away).
    const r = snapOffset(box, { x: 0, y: 171 }, all, 5)
    expect(r.offset.y).toBe(170)
    expect(r.guides.y).toEqual({ at: 230, from: 100, to: 340 })
  })

  it('merges the guides of objects sharing a line', () => {
    const twins = mergeLines(rectLines([other, { x: 300, y: 600, width: 10, height: 10 }]))
    const r = snapOffset(box, { x: 199, y: 0 }, twins, 5)
    expect(r.guides.x).toEqual({ at: 300, from: 50, to: 610 })
  })
})
