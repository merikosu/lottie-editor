/**
 * Seeded damage for robustness tests: deletes values and replaces them with junk (null, NaN,
 * strings, empty objects…) anywhere in a JSON document, the way hand edits and broken exporters
 * do. The same seed always damages the same places.
 */

/** Deterministic pseudo-random numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const JUNK: unknown[] = [null, Number.NaN, Infinity, -1, 0, 1e9, 'x', [], {}, [Number.NaN], true]

type Slot = { parent: Record<string | number, unknown>; key: string | number }

/** Damages `root` in place at `count` random places. */
export function damage(root: unknown, rand: () => number, count: number): void {
  const slots: Slot[] = []
  const walk = (v: unknown, depth: number) => {
    if (depth > 40 || v === null || typeof v !== 'object') return
    const parent = v as Record<string | number, unknown>
    const keys: (string | number)[] = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v)
    for (const key of keys) {
      slots.push({ parent, key })
      walk(parent[key], depth + 1)
    }
  }
  walk(root, 0)
  for (let i = 0; i < count && slots.length; i++) {
    const { parent, key } = slots[Math.floor(rand() * slots.length)]
    if (rand() < 0.35) {
      if (Array.isArray(parent)) parent.splice(key as number, 1)
      else delete parent[key]
    } else {
      const junk = JUNK[Math.floor(rand() * JUNK.length)]
      parent[key] = typeof junk === 'object' && junk !== null ? structuredClone(junk) : junk
    }
  }
}
