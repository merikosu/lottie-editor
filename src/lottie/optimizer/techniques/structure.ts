/**
 * Structural techniques: `hidden`, `invisible` and `empty`.
 *
 * Layers are only removed when nothing depends on them: parents (their transform drives
 * children even when hidden), matte sources and targets (removing one half of a pair makes the
 * other visible on some players) and, when expressions reach other layers or look items up by
 * index (`layer("…")`, `content(1)`, `numLayers`), nothing at all.
 */
import { findSegment } from '../../property'
import { mayRestructure } from '../expressions'
import { mergeIntervals, type Interval } from '../../stats'
import {
  arr,
  compLayers,
  compsById,
  hasExpression,
  isKeyframeList,
  isObj,
  listComps,
  num,
  protectedLayers,
  setCompLayers,
  type Comp,
  type Json,
} from '../model'
import type { TechniqueContext, TechniqueDetails } from './context'

/**
 * Removes the layers matching `candidate` that nothing depends on, repeatedly (removing a child
 * can free its parent). Returns the number of layers removed.
 */
export function removeLayers(
  comp: Comp,
  candidate: (layer: Json, index: number) => boolean,
): number {
  let removed = 0
  for (;;) {
    const layers = compLayers(comp)
    const keep = protectedLayers(layers)
    const drop = new Set<Json>()
    layers.forEach((layer, i) => {
      if (!keep.has(layer) && candidate(layer, i)) drop.add(layer)
    })
    if (drop.size === 0) return removed
    removed += drop.size
    setCompLayers(
      comp,
      arr(comp.owner.layers).filter((l) => !isObj(l) || !drop.has(l)),
    )
  }
}

/** Removes shape items (recursively in groups) matching `remove`; group transforms are kept. */
function removeShapeItems(
  items: unknown,
  remove: (item: Json) => boolean,
  onRemove: (item: Json) => void,
): unknown[] {
  const out: unknown[] = []
  for (const item of arr(items)) {
    if (isObj(item) && item.ty !== 'tr' && remove(item)) {
      onRemove(item)
      continue
    }
    if (isObj(item) && item.ty === 'gr') item.it = removeShapeItems(item.it, remove, onRemove)
    out.push(item)
  }
  return out
}

const MODIFIERS = new Set(['tm', 'rp', 'rd', 'mm', 'op', 'pb', 'tw', 'zz'])

/* -------------------------------------------------------------------------- */
/*                                   hidden                                   */
/* -------------------------------------------------------------------------- */

/**
 * `hidden`: layers and shape items switched off in After Effects (`hd: true`). Every player
 * skips them, except that lottie-web ignores the flag on groups and modifiers; those are removed
 * as After Effects (and the other players) intend, with a warning.
 */
export function hidden(tc: TechniqueContext): TechniqueDetails {
  if (!mayRestructure(tc.info.reach)) return { layers: 0, shapes: 0 }
  let layers = 0
  let shapes = 0
  let groups = 0
  for (const comp of listComps(tc.doc)) {
    layers += removeLayers(comp, (l) => l.hd === true)
    for (const layer of compLayers(comp)) {
      if (layer.ty !== 4) continue
      layer.shapes = removeShapeItems(
        layer.shapes,
        (it) => it.hd === true,
        (it) => {
          shapes++
          if (it.ty === 'gr' || MODIFIERS.has(String(it.ty))) groups++
        },
      )
    }
  }
  if (groups) tc.warn('hiddenGroups', groups)
  return { layers, shapes }
}

/* -------------------------------------------------------------------------- */
/*                                  invisible                                 */
/* -------------------------------------------------------------------------- */

/** Opacity (percent) below which nothing can show: alpha < 1/255 rounds to 0 everywhere. */
const INVISIBLE_OPACITY = 0.1

function scalarOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0]
  return undefined
}

/**
 * True when a scalar property stays (practically) zero during [from, to): every keyframe
 * segment overlapping the interval starts and ends at zero (easing cannot move a 0 → 0 segment).
 */
export function alwaysZero(
  prop: unknown,
  from: number,
  to: number,
  epsilon = INVISIBLE_OPACITY,
): boolean {
  if (!isObj(prop)) return false
  // Expressions and slots (themes) can change the value at runtime.
  if (hasExpression(prop) || typeof prop.sid === 'string') return false
  const zero = (v: unknown) => {
    const n = scalarOf(v)
    return n !== undefined && Math.abs(n) <= epsilon
  }
  if (!isKeyframeList(prop.k)) return zero(prop.k)
  const kfs = prop.k
  const times = kfs.map((kf) => (typeof kf.t === 'number' ? kf.t : NaN))
  if (times.some((t) => !Number.isFinite(t))) return false
  // Value before the first keyframe / after the last.
  if (from < times[0] && !zero(kfs[0].s ?? kfs[0].e)) return false
  const last = kfs.length - 1
  if (to > times[last]) {
    const lastValue = kfs[last].s ?? kfs[last - 1]?.e
    if (!zero(lastValue)) return false
  }
  const first = Math.max(0, findSegment(kfs as never, from))
  for (let i = first; i < last && times[i] < to; i++) {
    if (times[i + 1] <= from) continue
    const kf = kfs[i]
    if (!zero(kf.s)) return false
    if (kf.h === 1) continue
    const end = kfs[i + 1].s ?? kf.e
    if (!zero(end)) return false
  }
  return true
}

/** Frames of the composition during which the layer is on screen (comp time). */
function visibleIntervals(layer: Json, active: readonly Interval[]): Interval[] {
  const ip = num(layer.ip) ?? -Infinity
  const op = num(layer.op) ?? Infinity
  const out: Interval[] = []
  for (const a of active) {
    const start = Math.max(a.start, ip)
    const end = Math.min(a.end, op)
    if (end > start) out.push({ start, end })
  }
  return out
}

const EVERYTHING: Interval = { start: -Infinity, end: Infinity }

/**
 * Frames (in each composition's own time) during which the composition is on screen, keyed by
 * the object owning its `layers`. The root is shown on [ip, op] — the end frame included, since
 * players render frame `op` when asked for the last frame (goToAndStop(totalFrames), progress
 * 1). A precomposition is shown through its instances, mapping their visible range as
 * (t − st) / sr; time-remapped instances show any frame. Unreachable compositions are absent.
 */
export function compActivity(doc: Json): Map<Json, Interval[]> {
  const comps = listComps(doc)
  const byId = compsById(comps)
  const activity = new Map<Json, Interval[]>()
  const root = comps[0]
  const ip = num(doc.ip) ?? 0
  const op = num(doc.op) ?? ip
  activity.set(root.owner, [{ start: ip, end: op + 1e-6 }])
  const queue: Comp[] = [root]
  const visits = new Map<Comp, number>()
  while (queue.length) {
    const comp = queue.shift()!
    const count = (visits.get(comp) ?? 0) + 1
    visits.set(comp, count)
    const own = activity.get(comp.owner) ?? []
    for (const layer of compLayers(comp)) {
      if (layer.ty !== 0 || typeof layer.refId !== 'string') continue
      const child = byId.get(layer.refId)
      if (!child) continue
      const visible = visibleIntervals(layer, own)
      if (visible.length === 0) continue
      let inner: Interval[]
      // Recursion (precomp cycles) is capped: the child then counts as always shown.
      if (isObj(layer.tm) || count > 8) inner = [EVERYTHING]
      else {
        const st = num(layer.st) ?? 0
        const sr = num(layer.sr) || 1
        inner = visible.map((iv) => {
          const a = (iv.start - st) / sr
          const b = (iv.end - st) / sr
          return a <= b ? { start: a, end: b } : { start: b, end: a }
        })
      }
      const before = activity.get(child.owner) ?? []
      const after = mergeIntervals([...before, ...inner])
      const same =
        after.length === before.length &&
        after.every((x, i) => x.start === before[i].start && x.end === before[i].end)
      if (!same) {
        activity.set(child.owner, after)
        if (!queue.includes(child)) queue.push(child)
      }
    }
  }
  return activity
}

const STYLES = new Set(['fl', 'st', 'gf', 'gs'])

/**
 * `invisible`: layers fully transparent whenever they are on screen, and fills / strokes with a
 * static zero opacity.
 */
export function invisible(tc: TechniqueContext): TechniqueDetails {
  if (!mayRestructure(tc.info.reach)) return { layers: 0, shapes: 0 }
  const activity = compActivity(tc.doc)
  let layers = 0
  let shapes = 0
  for (const comp of listComps(tc.doc)) {
    const active = activity.get(comp.owner)
    if (active) {
      layers += removeLayers(comp, (l) => {
        // Audio and data layers have no opacity; cameras shape the 3D space.
        if (l.ty === 6 || l.ty === 13 || l.ty === 15) return false
        const visible = visibleIntervals(l, active)
        if (visible.length === 0) return false
        const o = isObj(l.ks) ? l.ks.o : undefined
        if (o === undefined) return false
        return visible.every((iv) => alwaysZero(o, iv.start, iv.end))
      })
    }
    for (const layer of compLayers(comp)) {
      if (layer.ty !== 4) continue
      layer.shapes = removeShapeItems(
        layer.shapes,
        (it) =>
          STYLES.has(String(it.ty)) &&
          isObj(it.o) &&
          !isKeyframeList(it.o.k) &&
          !hasExpression(it.o) &&
          alwaysZero(it.o, 0, 0),
        () => shapes++,
      )
    }
  }
  return { layers, shapes }
}

/* -------------------------------------------------------------------------- */
/*                                    empty                                   */
/* -------------------------------------------------------------------------- */

const GEOMETRY = new Set(['sh', 'rc', 'el', 'sr'])

/**
 * Marks the geometry items that some style paints. A style paints the geometry above it in its
 * group and in the groups nested there; `inherited` says whether a style below the group (in an
 * enclosing group) exists.
 */
function styledGroups(items: unknown, inherited: boolean, styledGroup: Set<Json>): boolean {
  const list = arr(items).filter(isObj)
  let painted = false
  let styleBelow = inherited
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    // lottie-web honours `hd` on geometry and styles only (hidden groups are `hidden`'s job).
    if (item.hd === true && item.ty !== 'gr') continue
    if (STYLES.has(String(item.ty))) styleBelow = true
    else if (GEOMETRY.has(String(item.ty))) {
      if (styleBelow) painted = true
    } else if (item.ty === 'gr') {
      if (styledGroups(item.it, styleBelow, styledGroup)) {
        styledGroup.add(item)
        painted = true
      }
    }
  }
  return painted
}

/** Removes groups that paint nothing: no geometry, or geometry that no style reaches. */
function removeEmptyGroups(layer: Json): number {
  const styled = new Set<Json>()
  styledGroups(layer.shapes, false, styled)
  let removed = 0
  const prune = (items: unknown): unknown[] =>
    arr(items).filter((item) => {
      if (!isObj(item) || item.ty !== 'gr') return true
      if (!styled.has(item)) {
        removed++
        return false
      }
      item.it = prune(item.it)
      return true
    })
  layer.shapes = prune(layer.shapes)
  return removed
}

/** True when a shape layer paints nothing at all. */
function paintsNothing(layer: Json): boolean {
  return !styledGroups(layer.shapes, false, new Set())
}

/**
 * `empty`: layers that are never on screen (out point before in point, or outside every frame
 * their composition is shown), shape layers and groups that paint nothing, and null layers that
 * are not parents.
 */
export function empty(tc: TechniqueContext): TechniqueDetails {
  if (!mayRestructure(tc.info.reach)) return { layers: 0, groups: 0 }
  const activity = compActivity(tc.doc)
  let layers = 0
  let groups = 0
  for (const comp of listComps(tc.doc)) {
    const active = activity.get(comp.owner)
    // Unreachable compositions are left to `unusedAssets`.
    if (!active) continue
    for (const layer of compLayers(comp)) if (layer.ty === 4) groups += removeEmptyGroups(layer)
    layers += removeLayers(comp, (l) => {
      const ip = num(l.ip)
      const op = num(l.op)
      if (
        ip !== undefined &&
        op !== undefined &&
        (op <= ip || visibleIntervals(l, active).length === 0)
      ) {
        // Audio can be played by lottie-web's audio factory regardless of drawing.
        return l.ty !== 6
      }
      if (l.ty === 4) return paintsNothing(l) && arr(l.ef).length === 0
      if (l.ty === 3) return arr(l.ef).length === 0
      return false
    })
  }
  return { layers, groups }
}
