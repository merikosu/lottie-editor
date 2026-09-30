// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { layerMatrix, applyMatrix, shapeItemsBounds } from '@/lottie/bounds'
import { importSvg } from '@/lottie/svg'
import type { ShapeItem } from '@/lottie/types'
import { fitScale, svgShapeLayer } from '../lib/svg-layer'

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect x="20" y="10" width="60" height="40" fill="#0a98fd"/>
  <circle cx="150" cy="60" r="30" fill="#ff5722"/>
</svg>`

function isValidGroupTree(items: readonly ShapeItem[]): boolean {
  return items.every((item) => {
    if (item.ty !== 'gr') return true
    const children = item.it ?? []
    return (
      children.length > 0 && children[children.length - 1].ty === 'tr' && isValidGroupTree(children)
    )
  })
}

describe('fitScale', () => {
  it('fits the limiting dimension into the fraction of the composition', () => {
    expect(fitScale({ x: 0, y: 0, w: 200, h: 100 }, { w: 400, h: 400 })).toBe(1)
    expect(fitScale({ x: 0, y: 0, w: 100, h: 400 }, { w: 400, h: 400 })).toBe(0.5)
    expect(fitScale({ x: 0, y: 0, w: 10, h: 10 }, { w: 400, h: 400 }, 0.25)).toBe(10)
  })

  it('handles flat and empty boxes', () => {
    expect(fitScale({ x: 0, y: 0, w: 100, h: 0 }, { w: 400, h: 400 })).toBe(2)
    expect(fitScale({ x: 0, y: 0, w: 0, h: 0 }, { w: 400, h: 400 })).toBe(1)
  })
})

describe('svgShapeLayer', () => {
  it('centers the drawing and fits it to half of the composition', () => {
    const svg = importSvg(LOGO, { name: 'logo' })
    const layer = svgShapeLayer(svg.shapes, svg.bounds, {
      name: 'logo',
      ind: 7,
      ip: 0,
      op: 60,
      comp: { w: 512, h: 512 },
    })
    expect(layer.ty).toBe(4)
    expect(layer.ind).toBe(7)
    expect(layer.nm).toBe('logo')
    expect(isValidGroupTree(layer.shapes)).toBe(true)

    // The drawing's bounds, mapped through the layer transform, are centered and 256 px wide.
    const box = shapeItemsBounds(layer.shapes, 0, { includeStroke: true })!
    const m = layerMatrix(layer, 0)
    const [x0, y0] = applyMatrix(m, box.x, box.y)
    const [x1, y1] = applyMatrix(m, box.x + box.w, box.y + box.h)
    expect(x1 - x0).toBeCloseTo(256, 1)
    expect((x0 + x1) / 2).toBeCloseTo(256, 1)
    expect((y0 + y1) / 2).toBeCloseTo(256, 1)
    expect(y1 - y0).toBeLessThanOrEqual(256.01)
  })

  it('does not alias the imported shapes', () => {
    const svg = importSvg(LOGO)
    const layer = svgShapeLayer(svg.shapes, svg.bounds, {
      name: 'x',
      ind: 1,
      ip: 0,
      op: 1,
      comp: { w: 100, h: 100 },
    })
    ;(layer.shapes[0] as { nm?: string }).nm = 'changed'
    expect((svg.shapes[0] as { nm?: string }).nm).not.toBe('changed')
  })
})
