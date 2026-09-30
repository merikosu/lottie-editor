/**
 * Just enough of the Lottie format to check the files the app writes: structural validity
 * (what players need to load a file) and helpers to find layers and paint colors.
 */
import { expect } from '@playwright/test'

export interface LottieLayer {
  ty: number
  nm?: string
  ind?: number
  ip: number
  op: number
  st?: number
  refId?: string
  ks: Record<string, { a?: number; k: unknown }>
  shapes?: unknown[]
}

export interface LottieAsset {
  id: string
  nm?: string
  layers?: LottieLayer[]
  p?: string
}

export interface Lottie {
  v: string
  fr: number
  ip: number
  op: number
  w: number
  h: number
  nm?: string
  layers: LottieLayer[]
  assets?: LottieAsset[]
  markers?: { cm: string; tm: number; dr: number }[]
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function checkLayers(layers: unknown, where: string, assetIds: Set<string>): void {
  expect(Array.isArray(layers), `${where}: layers is an array`).toBe(true)
  for (const [i, layer] of (layers as unknown[]).entries()) {
    const at = `${where}.layers[${i}]`
    expect(isObject(layer), `${at} is an object`).toBe(true)
    const l = layer as Record<string, unknown>
    expect(typeof l.ty, `${at}.ty`).toBe('number')
    expect(typeof l.ip, `${at}.ip`).toBe('number')
    expect(typeof l.op, `${at}.op`).toBe('number')
    expect(isObject(l.ks), `${at}.ks is the transform`).toBe(true)
    if (l.ty === 4) expect(Array.isArray(l.shapes), `${at}.shapes`).toBe(true)
    if (l.ty === 0 || l.ty === 2) {
      expect(assetIds.has(String(l.refId)), `${at}.refId "${String(l.refId)}" exists`).toBe(true)
    }
  }
}

/** Asserts that `value` is a structurally valid Lottie animation and narrows its type. */
export function expectLottie(value: unknown): asserts value is Lottie {
  expect(isObject(value), 'a Lottie file is a JSON object').toBe(true)
  const anim = value as Record<string, unknown>
  expect(anim.v, 'version').toMatch(/^\d+\.\d+\.\d+/)
  for (const key of ['fr', 'w', 'h'] as const) {
    expect(typeof anim[key] === 'number' && (anim[key] as number) > 0, `${key} > 0`).toBe(true)
  }
  expect(typeof anim.ip, 'ip').toBe('number')
  expect(typeof anim.op, 'op').toBe('number')
  expect(anim.op as number, 'op after ip').toBeGreaterThan(anim.ip as number)
  const assets = (Array.isArray(anim.assets) ? anim.assets : []) as unknown[]
  const ids = new Set(assets.filter(isObject).map((a) => String(a.id)))
  checkLayers(anim.layers, 'root', ids)
  for (const asset of assets.filter(isObject)) {
    if (asset.layers !== undefined) checkLayers(asset.layers, `asset "${String(asset.id)}"`, ids)
  }
}

/** Every layer of the animation (root and precomps), depth-first. */
export function allLayers(anim: Lottie): LottieLayer[] {
  return [...anim.layers, ...(anim.assets ?? []).flatMap((a) => a.layers ?? [])]
}

/** The only layer named `name` anywhere in the animation. */
export function layerNamed(anim: Lottie, name: string): LottieLayer {
  const found = allLayers(anim).filter((l) => l.nm === name)
  expect(found, `exactly one layer named "${name}"`).toHaveLength(1)
  return found[0]
}

/** "#RRGGBB" of a Lottie color ([r, g, b, a?] in 0–1). */
function toHex(channels: number[]): string {
  const hex = channels.slice(0, 3).map((c) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${hex.join('')}`.toUpperCase()
}

/**
 * Static fill and stroke colors ("#RRGGBB") under `node` (a layer, shapes or a whole file),
 * e.g. `{ fill: ['#12B886'], stroke: ['#FFFFFF'] }`.
 */
export function paintColors(node: unknown): { fill: string[]; stroke: string[] } {
  const out = { fill: [] as string[], stroke: [] as string[] }
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit)
    if (!isObject(v)) return
    if ((v.ty === 'fl' || v.ty === 'st') && isObject(v.c) && Array.isArray(v.c.k)) {
      const k = v.c.k as unknown[]
      if (k.every((c) => typeof c === 'number')) {
        out[v.ty === 'fl' ? 'fill' : 'stroke'].push(toHex(k as number[]))
      }
    }
    Object.values(v).forEach(visit)
  }
  visit(node)
  return out
}
