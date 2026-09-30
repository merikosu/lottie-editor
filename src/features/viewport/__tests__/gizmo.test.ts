import { describe, expect, it } from 'vitest'
import { transformRect, type Quad } from '../lib/geometry'
import {
  GIZMO,
  gizmoHandleIds,
  handlePoint,
  hitGizmo,
  pointInQuad,
  resizeCursor,
  rotateCursor,
  showsEdgeHandles,
} from '../lib/gizmo'
import { IDENTITY, multiply, rotate, scale, translate, type Mat2D } from '../lib/matrix'

/** A 100 × 60 box centered at (150, 130) on screen, transformed by `m` about its center. */
function quad(m: Mat2D = IDENTITY): Quad {
  const box = { x: -50, y: -30, width: 100, height: 60 }
  return transformRect(box, multiply(translate(IDENTITY, 150, 130), m))
}

describe('hitGizmo', () => {
  const q = quad()

  it('grabs corners and edges a few pixels inside and outside', () => {
    expect(hitGizmo(q, { x: 100, y: 100 })).toEqual({ kind: 'resize', handle: 'nw' })
    expect(hitGizmo(q, { x: 97, y: 97 })).toEqual({ kind: 'resize', handle: 'nw' })
    expect(hitGizmo(q, { x: 203, y: 163 })).toEqual({ kind: 'resize', handle: 'se' })
    expect(hitGizmo(q, { x: 150, y: 98 })).toEqual({ kind: 'resize', handle: 'n' })
    // Anywhere along an edge, not only at its middle.
    expect(hitGizmo(q, { x: 120, y: 162 })).toEqual({ kind: 'resize', handle: 's' })
    expect(hitGizmo(q, { x: 203, y: 110 })).toEqual({ kind: 'resize', handle: 'e' })
    expect(hitGizmo(q, { x: 99, y: 150 })).toEqual({ kind: 'resize', handle: 'w' })
  })

  it('is inside in the middle, rotates just outside a corner, misses further away', () => {
    expect(hitGizmo(q, { x: 150, y: 130 })).toEqual({ kind: 'inside' })
    expect(hitGizmo(q, { x: 110, y: 110 })).toEqual({ kind: 'inside' })
    expect(hitGizmo(q, { x: 90, y: 90 })).toEqual({ kind: 'rotate', corner: 'nw' })
    expect(hitGizmo(q, { x: 212, y: 90 })).toEqual({ kind: 'rotate', corner: 'ne' })
    expect(hitGizmo(q, { x: 200 + GIZMO.rotateRadius, y: 180 })).toBeNull()
    expect(hitGizmo(q, { x: 150, y: 80 })).toBeNull()
  })

  it('names handles after the content box when the node is flipped or rotated', () => {
    // Mirrored horizontally: the content's left edge is on the right of the screen.
    const flipped = quad(scale(IDENTITY, -1, 1))
    expect(hitGizmo(flipped, { x: 100, y: 100 })).toEqual({ kind: 'resize', handle: 'ne' })
    expect(hitGizmo(flipped, { x: 201, y: 130 })).toEqual({ kind: 'resize', handle: 'w' })
    // A quarter turn clockwise: the content's top edge is on the right.
    const turned = quad(rotate(IDENTITY, 90))
    const n = handlePoint(turned, 'n')
    expect(n.x).toBeCloseTo(180, 6)
    expect(hitGizmo(turned, { x: 181, y: 130 })).toEqual({ kind: 'resize', handle: 'n' })
  })

  it('leaves the middle of small boxes for moving', () => {
    const small = quad(scale(IDENTITY, 0.12, 0.2)) // 12 × 12
    expect(hitGizmo(small, { x: 150, y: 130 })).toEqual({ kind: 'inside' })
    expect(hitGizmo(small, { x: 144, y: 124 })).toEqual({ kind: 'resize', handle: 'nw' })
    expect(showsEdgeHandles(small)).toBe(false)
    expect(showsEdgeHandles(q)).toBe(true)
  })

  it('moves a thin bar when pressed on it; its thickness is grabbed from outside', () => {
    const bar = quad(scale(IDENTITY, 3, 0.06)) // 300 × 3.6
    expect(hitGizmo(bar, { x: 150, y: 129 })).toEqual({ kind: 'inside' })
    expect(hitGizmo(bar, { x: 150, y: 131.5 })).toEqual({ kind: 'inside' })
    expect(hitGizmo(bar, { x: 150, y: 126 })).toEqual({ kind: 'resize', handle: 'n' })
    expect(hitGizmo(bar, { x: 150, y: 134 })).toEqual({ kind: 'resize', handle: 's' })
    // Its ends resize its length, also where the end handle reaches past its thickness.
    expect(hitGizmo(bar, { x: 297, y: 130 })).toEqual({ kind: 'resize', handle: 'e' })
    expect(hitGizmo(bar, { x: 299, y: 126.5 })).toEqual({ kind: 'resize', handle: 'e' })
    expect(hitGizmo(bar, { x: 1, y: 133.5 })).toEqual({ kind: 'resize', handle: 'w' })
    expect(gizmoHandleIds(bar)).toEqual(['w', 'e'])
    expect(gizmoHandleIds(quad(scale(IDENTITY, 0.06, 3)))).toEqual(['n', 's'])
    expect(gizmoHandleIds(quad())).toHaveLength(8)
    expect(gizmoHandleIds(quad(scale(IDENTITY, 0.2, 0.3)))).toEqual(['nw', 'ne', 'se', 'sw'])
  })

  it('treats a box without height (a straight horizontal stroke) as a line', () => {
    const line = quad(scale(IDENTITY, 1, 0)) // from (100, 130) to (200, 130)
    expect(gizmoHandleIds(line)).toEqual(['w', 'e'])
    // Its ends resize its length, a few pixels either way along it and across it.
    expect(hitGizmo(line, { x: 200, y: 130 })).toEqual({ kind: 'resize', handle: 'e' })
    expect(hitGizmo(line, { x: 204, y: 133 })).toEqual({ kind: 'resize', handle: 'e' })
    expect(hitGizmo(line, { x: 97, y: 126 })).toEqual({ kind: 'resize', handle: 'w' })
    // The band along it moves it; a press farther away misses.
    expect(hitGizmo(line, { x: 150, y: 130 })).toEqual({ kind: 'inside' })
    expect(hitGizmo(line, { x: 150, y: 134.5 })).toEqual({ kind: 'inside' })
    expect(hitGizmo(line, { x: 150, y: 137 })).toBeNull()
    // Just past an end it turns.
    expect(hitGizmo(line, { x: 212, y: 130 })).toEqual({ kind: 'rotate', corner: 'ne' })
    expect(hitGizmo(line, { x: 100, y: 142 })).toEqual({ kind: 'rotate', corner: 'nw' })
    expect(hitGizmo(line, { x: 200 + GIZMO.rotateRadius + 1, y: 130 })).toBeNull()
    expect(resizeCursor(line, 'e')).toBe('ew-resize')
    expect(decodeURIComponent(rotateCursor(line, 'ne'))).toContain('rotate(-45 12 12)')
  })

  it('treats vertical, turned and hairline boxes as lines too', () => {
    const vertical = quad(scale(IDENTITY, 0, 1)) // from (150, 100) to (150, 160)
    expect(gizmoHandleIds(vertical)).toEqual(['n', 's'])
    expect(hitGizmo(vertical, { x: 151, y: 99 })).toEqual({ kind: 'resize', handle: 'n' })
    expect(hitGizmo(vertical, { x: 148, y: 130 })).toEqual({ kind: 'inside' })
    expect(resizeCursor(vertical, 's')).toBe('ns-resize')
    // Turned by 45°: its ends lie on the diagonal.
    const turned = quad(multiply(rotate(IDENTITY, 45), scale(IDENTITY, 1, 0)))
    const e = handlePoint(turned, 'e')
    expect(hitGizmo(turned, e)).toEqual({ kind: 'resize', handle: 'e' })
    expect(hitGizmo(turned, { x: 150, y: 130 })).toEqual({ kind: 'inside' })
    expect(resizeCursor(turned, 'w')).toBe('nwse-resize')
    // Less than a pixel thick: still a line (its thickness is its stroke).
    const hairline = quad(scale(IDENTITY, 2, 0.01)) // 200 × 0.6
    expect(gizmoHandleIds(hairline)).toEqual(['w', 'e'])
    expect(hitGizmo(hairline, { x: 150, y: 127 })).toEqual({ kind: 'inside' })
    // A pixel or thicker: a bar, whose thickness is grabbed from outside.
    const bar = quad(scale(IDENTITY, 2, 0.02)) // 200 × 1.2
    expect(hitGizmo(bar, { x: 150, y: 127 })).toEqual({ kind: 'resize', handle: 'n' })
    // A dot has nothing to grab.
    const dot = quad(scale(IDENTITY, 0.005, 0))
    expect(hitGizmo(dot, { x: 150, y: 130 })).toBeNull()
  })
})

describe('pointInQuad', () => {
  it('tests both windings', () => {
    const q = quad()
    expect(pointInQuad(q, { x: 150, y: 130 })).toBe(true)
    expect(pointInQuad(q, { x: 99, y: 130 })).toBe(false)
    const reversed = [...q].reverse() as unknown as Quad
    expect(pointInQuad(reversed, { x: 150, y: 130 })).toBe(true)
  })
})

describe('cursors', () => {
  it('picks the resize cursor by the handle direction on screen', () => {
    const q = quad()
    expect(resizeCursor(q, 'e')).toBe('ew-resize')
    expect(resizeCursor(q, 'w')).toBe('ew-resize')
    expect(resizeCursor(q, 'n')).toBe('ns-resize')
    expect(resizeCursor(q, 'nw')).toBe('nwse-resize')
    expect(resizeCursor(q, 'se')).toBe('nwse-resize')
    expect(resizeCursor(q, 'ne')).toBe('nesw-resize')
    // Wide boxes keep diagonal cursors at their corners.
    expect(resizeCursor(quad(scale(IDENTITY, 6, 1)), 'se')).toBe('nwse-resize')
    // Turned by 90°: the right edge now faces down.
    expect(resizeCursor(quad(rotate(IDENTITY, 90)), 'e')).toBe('ns-resize')
    // Turned by 45°: the right edge faces down-right.
    expect(resizeCursor(quad(rotate(IDENTITY, 45)), 'e')).toBe('nwse-resize')
    expect(resizeCursor(quad(rotate(IDENTITY, 45)), 'se')).toBe('ns-resize')
  })

  it('draws the rotate cursor turned towards the corner', () => {
    const q = quad()
    const se = rotateCursor(q, 'se')
    const nw = rotateCursor(q, 'nw')
    expect(se).toMatch(/^url\("data:image\/svg\+xml,.+"\) 12 12, auto$/)
    expect(decodeURIComponent(se)).toContain('rotate(0 12 12)')
    expect(decodeURIComponent(nw)).toContain('rotate(180 12 12)')
    expect(rotateCursor(q, 'se')).toBe(se)
  })
})
