/**
 * Structural sharing for applied JSON: returns `next` with every subtree that is deeply equal
 * to the corresponding subtree of `prev` replaced by the `prev` object itself.
 *
 * Applying edited JSON parses a brand-new object tree; without this, a one-number edit would
 * give the whole document a new identity and every identity-memoized view (layers, colors,
 * timeline, the JSON formatter cache) would recompute from scratch.
 */
export function reconcile<T>(prev: unknown, next: T): T {
  return reconcileValue(prev, next) as T
}

function reconcileValue(prev: unknown, next: unknown): unknown {
  if (prev === next) return prev
  if (prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') {
    return Object.is(prev, next) ? prev : next
  }
  if (Array.isArray(prev) !== Array.isArray(next)) return next

  if (Array.isArray(next)) {
    const before = prev as unknown[]
    let same = before.length === next.length
    const out: unknown[] = []
    for (let i = 0; i < next.length; i++) {
      const r = i < before.length ? reconcileValue(before[i], next[i]) : next[i]
      out.push(r)
      if (same && r !== before[i]) same = false
    }
    return same ? prev : out
  }

  const before = prev as Record<string, unknown>
  const after = next as Record<string, unknown>
  const prevKeys = Object.keys(before)
  const nextKeys = Object.keys(after)
  // Key order is part of the text the user sees, so a reordered object is a new object.
  let same = prevKeys.length === nextKeys.length
  const out: Record<string, unknown> = {}
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i]
    const r = Object.hasOwn(before, key) ? reconcileValue(before[key], after[key]) : after[key]
    // A plain assignment of "__proto__" would call the prototype setter instead.
    if (key === '__proto__')
      Object.defineProperty(out, key, {
        value: r,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    else out[key] = r
    if (same && (prevKeys[i] !== key || r !== before[key])) same = false
  }
  return same ? prev : out
}
