/**
 * Shared helpers for the remix engine tests (SVG import, bounds, replace).
 */
import type { Animation, BezierPath, GroupShape, Layer, ShapeItem } from '../../../types'

const FIXTURES = import.meta.glob<string>('./*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Text of an SVG fixture of this folder. */
export function fixture(name: string): string {
  const text = FIXTURES[`./${name}`]
  if (text === undefined) throw new Error(`Missing fixture ${name}`)
  return text
}

const DOCS = import.meta.glob<string>('../../../../../docs/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Text of a document in /docs (undefined when the file is not present). */
export function docText(name: string): string | undefined {
  return DOCS[`../../../../../docs/${name}`]
}

/** Point on the cubic segment k → k+1 of a Lottie path at parameter t. */
export function segmentPoint(p: BezierPath, k: number, t: number): [number, number] {
  const n = p.v.length
  const a = p.v[k]
  const b = p.v[(k + 1) % n]
  const c1 = [a[0] + p.o[k][0], a[1] + p.o[k][1]]
  const c2 = [b[0] + p.i[(k + 1) % n][0], b[1] + p.i[(k + 1) % n][1]]
  const mt = 1 - t
  const f = (d: 0 | 1) =>
    mt * mt * mt * a[d] + 3 * mt * mt * t * c1[d] + 3 * mt * t * t * c2[d] + t * t * t * b[d]
  return [f(0), f(1)]
}

/** Samples every drawn segment of a path (closing segment included when closed). */
export function samplePath(p: BezierPath, steps = 24): [number, number][] {
  const out: [number, number][] = []
  const segs = p.c ? p.v.length : p.v.length - 1
  for (let k = 0; k < segs; k++)
    for (let s = 0; s <= steps; s++) out.push(segmentPoint(p, k, s / steps))
  return out
}

/** Every `gr` ends with a `tr`, recursively. Returns the offending group names. */
export function groupsWithoutTransform(items: readonly ShapeItem[]): string[] {
  const bad: string[] = []
  const walk = (list: readonly ShapeItem[]) => {
    for (const item of list) {
      if (item.ty !== 'gr') continue
      const it = item.it
      if (!Array.isArray(it) || it.length === 0 || it[it.length - 1].ty !== 'tr')
        bad.push(item.nm ?? '?')
      walk(it ?? [])
    }
  }
  walk(items)
  return bad
}

/** Items of type `ty` found anywhere under `items` (depth-first). */
export function findItems<T extends ShapeItem['ty']>(
  items: readonly ShapeItem[],
  ty: T,
): Extract<ShapeItem, { ty: T }>[] {
  const out: ShapeItem[] = []
  const walk = (list: readonly ShapeItem[]) => {
    for (const item of list) {
      if (item.ty === ty) out.push(item)
      if (item.ty === 'gr') walk(item.it ?? [])
    }
  }
  walk(items)
  return out as Extract<ShapeItem, { ty: T }>[]
}

export function asGroup(item: ShapeItem | undefined): GroupShape {
  if (!item || item.ty !== 'gr') throw new Error(`expected a group, got ${item?.ty}`)
  return item
}

/** Checks the whole document is a tree (no object reachable twice). */
export function findAliases(root: unknown): string[] {
  const seen = new Map<object, string>()
  const aliases: string[] = []
  const walk = (node: unknown, path: string) => {
    if (node === null || typeof node !== 'object') return
    const prev = seen.get(node)
    if (prev !== undefined) {
      aliases.push(`${path} = ${prev}`)
      return
    }
    seen.set(node, path)
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}/${i}`))
    else for (const [k, v] of Object.entries(node)) walk(v, `${path}/${k}`)
  }
  walk(root, '')
  return aliases
}

/** Structural validity problems of a document (what lottie-web needs from our output). */
export function documentProblems(anim: Animation): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const a of anim.assets ?? []) {
    if (ids.has(a.id)) problems.push(`duplicate asset id ${a.id}`)
    ids.add(a.id)
  }
  const checkLayers = (layers: Layer[], where: string) => {
    const inds = new Set<number>()
    for (const l of layers) {
      if (typeof l.ind === 'number') {
        if (inds.has(l.ind)) problems.push(`${where}: duplicate ind ${l.ind}`)
        inds.add(l.ind)
      }
      if ('refId' in l && l.refId !== undefined && !ids.has(l.refId))
        problems.push(`${where}: missing asset ${l.refId}`)
      if (l.ty === 4) {
        for (const g of groupsWithoutTransform(l.shapes))
          problems.push(`${where}/${l.nm}: group ${g} has no tr`)
        for (const rc of findItems(l.shapes, 'rc'))
          if (!rc.r) problems.push(`${where}: rc without r`)
        for (const fl of findItems(l.shapes, 'fl'))
          if (!fl.o || !fl.c) problems.push(`${where}: fill without o/c`)
        for (const st of findItems(l.shapes, 'st'))
          if (!st.o || !st.c || !st.w) problems.push(`${where}: stroke without o/c/w`)
      }
    }
    for (const l of layers) {
      if (l.parent !== undefined && !inds.has(l.parent))
        problems.push(`${where}: parent ${l.parent} missing`)
    }
  }
  checkLayers(anim.layers, 'root')
  for (const a of anim.assets ?? [])
    if ('layers' in a && Array.isArray(a.layers)) checkLayers(a.layers, a.id)
  return problems
}

/** Max number of decimals among numbers under `node`. */
export function maxDecimals(node: unknown): number {
  let max = 0
  const walk = (v: unknown) => {
    if (typeof v === 'number') {
      if (Number.isFinite(v) && !Number.isInteger(v)) {
        const s = String(v)
        const d = s.includes('e-') ? 20 : (s.split('.')[1]?.length ?? 0)
        if (d > max) max = d
      }
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(node)
  return max
}
