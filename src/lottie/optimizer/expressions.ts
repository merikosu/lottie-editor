/**
 * What After Effects expressions in a file can reach, from a conservative scan of their code.
 *
 * lottie-web evaluates expressions by default, so an optimization that removes something an
 * expression reads would change the animation there. Parsing JavaScript reliably is out of
 * reach, but the ways expressions address other things are few and spelled out: `layer(…)`,
 * `comp(…)`, `content(…)`, `.key(…)`, `points()`… Each flag is raised by any occurrence of
 * such an access (false positives only make the optimizer more careful); techniques that could
 * affect what a flag covers stand down when it is raised. Plain value expressions (`wiggle`,
 * `loopOut`, `value * 2`, the expression property's own `key(n)` / `numKeys`) raise nothing.
 */

export interface ExpressionReach {
  /** Number of properties with an expression. */
  count: number
  /** Items looked up by index or match name (`content(1)`, `transform("Scale")`, `"ADBE …"`). */
  indexed: boolean
  /** Other layers or compositions, the layer count, parents (`layer(…)`, `comp(…)`, `numLayers`). */
  layers: boolean
  /** Keyframes of other properties (`position.key(1)`, `.numKeys`, `.nearestKey(t)`). */
  keys: boolean
  /** Path vertices (`points()`, `inTangents()`, `createPath()`, `.path`). */
  paths: boolean
}

const INDEXED =
  /\bcontent\s*\(|\btransform\s*\(|\bmask\s*\(|ADBE|propertyGroup|propertyIndex|numProperties|\bproperty\s*\(/
const LAYERS =
  /\blayer\s*\(|\bcomp\s*\(|\bnumLayers\b|\bparent\b|\bsourceRectAtTime\b|\bsampleImage\b/
// A dot before the accessor means "keys of some other property" (bare `key(n)` is the
// expression's own property, which the optimizer never simplifies).
const KEYS = /\.\s*(key|numKeys|nearestKey)\b|\bkeyTime\b|\bkeyValue\b/
const PATHS = /\b(points|inTangents|outTangents|isClosed|createPath)\s*\(|\.path\b/

export const NO_EXPRESSIONS: ExpressionReach = {
  count: 0,
  indexed: false,
  layers: false,
  keys: false,
  paths: false,
}

/** Scans expression sources (one per property). */
export function expressionReach(sources: Iterable<string>): ExpressionReach {
  const r: ExpressionReach = { ...NO_EXPRESSIONS }
  for (const code of sources) {
    r.count++
    if (!r.indexed && INDEXED.test(code)) r.indexed = true
    if (!r.layers && LAYERS.test(code)) r.layers = true
    if (!r.keys && KEYS.test(code)) r.keys = true
    if (!r.paths && PATHS.test(code)) r.paths = true
  }
  return r
}

/** Layers, shapes and assets may be removed or merged. */
export function mayRestructure(r: ExpressionReach): boolean {
  return r.count === 0 || (!r.indexed && !r.layers)
}

/** Keyframes of properties without their own expression may be removed. */
export function maySimplifyKeys(r: ExpressionReach): boolean {
  return r.count === 0 || !r.keys
}

/** Path vertices may be removed. */
export function maySimplifyPaths(r: ExpressionReach): boolean {
  return r.count === 0 || (!r.paths && !r.indexed)
}

/** `ix`, `cix`, `np`, `mn` and identity transform values may be removed. */
export function mayDropIndices(r: ExpressionReach): boolean {
  return r.count === 0 || !r.indexed
}

/** Names may be removed (layer names only when `layers` too). */
export function mayDropNames(r: ExpressionReach, includingLayers: boolean): boolean {
  return r.count === 0 || (!r.indexed && !(includingLayers && r.layers))
}
