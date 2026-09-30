/**
 * Document validation: problems that break or degrade playback in real players, grouped into
 * issues with the paths of every occurrence, plus the automatic fixes.
 *
 * An issue is language-neutral: `code` + `params` are turned into a message by the UI.
 * Player-specific issues list the affected players with a support level (see compat.ts), so
 * the UI can re-grade them for the chosen target without validating again. Issues without
 * `platforms` affect every player.
 *
 * Fixes run inside an immer recipe (`applyFixes(draft, issues)`). A fix is marked `safe` when
 * it cannot change anything that currently renders correctly: it only repairs data that makes
 * some player fail, or normalizes structure the preview already treats that way.
 */
import {
  affectedPlayers,
  arr,
  detectFeatures,
  FEATURE_IDS,
  findParentCycles,
  findPrecompCycles,
  isObj,
  levelRank,
  num,
  scanDocument,
  severityFor,
  TARGETS,
  worstLevel,
  type CompRef,
  type Json,
  type LayerRef,
  type Level,
  type PlayerId,
  type TargetId,
} from './compat'
import { getAt, pathKey, type NodePath } from './path'
import { inspectDataUri, isLayerEverVisible } from './stats'
import type { Animation } from './types'

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

export type Severity = 'error' | 'warning' | 'info'

/** Issue codes in display order (within a severity group). */
export const ISSUE_CODES = [
  // Document
  'doc.frameRate',
  'doc.range',
  'doc.size',
  'doc.version',
  // Structure that stops players from loading the file
  'layer.parentCycle',
  'asset.cycle',
  'asset.missing',
  'layer.missingTransform',
  'layer.missingInOut',
  'layer.missingStart',
  'shape.missingShapes',
  'shape.groupNoItems',
  'shape.groupTransform',
  'shape.pathMalformed',
  'shape.internal',
  'gradient.stops',
  'prop.missing',
  'prop.singleKeyframe',
  'prop.missingEasing',
  'prop.unsorted',
  'prop.badKeyframe',
  'prop.animatedFlag',
  'prop.incomplete3d',
  'prop.splitPosition',
  'value.nonFinite',
  'value.notInteger',
  'value.notBoolean',
  'layer.duplicateInd',
  'asset.duplicateId',
  'precomp.missingSize',
  'image.missingFields',
  // Mattes and masks
  'matte.noSource',
  'matte.sourceFlag',
  'matte.hiddenSource',
  'matte.notAdjacent',
  'matte.canvasLookup',
  'matte.orphan',
  'matte.explicitVisible',
  'mask.flag',
  'mask.fields',
  'mask.keyOrder',
  'effect.disabled',
  'effect.keyOrder',
  'layer.keyOrder3d',
  // Text
  'text.noFonts',
  'text.emptyChars',
  'text.unknownFont',
  'text.missingGlyphs',
  'text.newline',
  // Telegram stickers
  'telegram.size',
  'telegram.fps',
  'telegram.duration',
  'telegram.fileSize',
  // Feature support
  'compat',
  // Softer structure problems and hints
  'layer.parentMissing',
  'layer.missingInd',
  'layer.stretchZero',
  'layer.neverVisible',
  'shape.vertexCount',
  'image.external',
  'image.huge',
  'image.aspect',
  'image.oversized',
  'shape.emptyLayer',
  'asset.unused',
  'prop.legacyKeyframes',
  'doc.legacyVersion',
  'perf.fileSize',
  'perf.layers',
  'perf.masks',
  'perf.keyframes',
  'perf.frames',
  'perf.canvas',
] as const

export type IssueCode = (typeof ISSUE_CODES)[number]

export type IssueParams = Readonly<Record<string, string | number>>

export interface PlatformImpact {
  player: PlayerId
  level: Exclude<Level, 'y'>
}

export type FixId =
  | 'setVersion'
  | 'breakParentCycle'
  | 'removeParent'
  | 'renumberInd'
  | 'assignInd'
  | 'resetStretch'
  | 'addStart'
  | 'addInOut'
  | 'addTransform'
  | 'removeUnusedAssets'
  | 'renameDuplicateAsset'
  | 'addPrecompSize'
  | 'completeImage'
  | 'addShapes'
  | 'addGroupItems'
  | 'fixGroupTransform'
  | 'repairPath'
  | 'removeItem'
  | 'addDefaultProperty'
  | 'makeStatic'
  | 'addEasing'
  | 'sortKeyframes'
  | 'removeBadKeyframes'
  | 'syncAnimatedFlag'
  | 'upgradeKeyframes'
  | 'complete3d'
  | 'zeroNonFinite'
  | 'roundIntegers'
  | 'toBoolean'
  | 'setMatteParent'
  | 'flagMatteSource'
  | 'moveMatteSource'
  | 'removeOrphanMatte'
  | 'unhideMatteSource'
  | 'dropVisibleFlag'
  | 'setHasMask'
  | 'completeMask'
  | 'reorderKeys'
  | 'enableEffect'
  | 'removeDisabledEffect'
  | 'removeChars'
  | 'lineBreaks'
  | 'removeExpressions'
  | 'removeCameras'

export interface Issue {
  /** Stable id: equal issues keep their id across validations. */
  id: string
  /** Severity for the default target ("all players"); see `issuesForTarget`. */
  severity: Severity
  code: IssueCode
  params: IssueParams
  /** Paths of the occurrences (layers, shape items, properties, assets; [] = the document). */
  paths: NodePath[]
  /** Number of occurrences (`paths` may be capped). */
  count: number
  /** Players affected, with their support level; absent = every player. */
  platforms?: PlatformImpact[]
  fix?: FixId
  /** The fix never changes what already renders correctly ("Fix all safe" applies it). */
  safe?: boolean
}

export interface ValidateContext {
  /** Minified JSON size in bytes (enables the file size check). */
  rawBytes?: number
  /** Gzip size in bytes (enables the Telegram sticker size check). */
  gzipBytes?: number
}

/* -------------------------------------------------------------------------- */
/*                                 Thresholds                                 */
/* -------------------------------------------------------------------------- */

export const LIMITS = {
  layers: 500,
  masks: 50,
  keyframes: 10_000,
  fileBytes: 5 * 1024 * 1024,
  frames: 1000,
  canvas: 4096,
  imageBytes: 500 * 1024,
  telegramBytes: 64 * 1024,
  telegramSize: 512,
  telegramFps: 60,
  telegramSeconds: 3,
} as const

/** Default severity of codes whose players are not listed (or not derived). */
const BASE_SEVERITY: Record<IssueCode, Severity> = {
  'doc.frameRate': 'error',
  'doc.range': 'error',
  'doc.size': 'error',
  'doc.version': 'error',
  'layer.parentCycle': 'error',
  'asset.cycle': 'error',
  'asset.missing': 'error',
  'layer.missingTransform': 'error',
  'layer.missingInOut': 'error',
  'layer.missingStart': 'error',
  'shape.missingShapes': 'error',
  'shape.groupNoItems': 'error',
  'shape.groupTransform': 'warning',
  'shape.pathMalformed': 'error',
  'shape.internal': 'error',
  'gradient.stops': 'error',
  'prop.missing': 'error',
  'prop.singleKeyframe': 'error',
  'prop.missingEasing': 'error',
  'prop.unsorted': 'error',
  'prop.badKeyframe': 'error',
  'prop.animatedFlag': 'error',
  'prop.incomplete3d': 'error',
  'prop.splitPosition': 'error',
  'value.nonFinite': 'error',
  'value.notInteger': 'error',
  'value.notBoolean': 'error',
  'layer.duplicateInd': 'error',
  'asset.duplicateId': 'error',
  'precomp.missingSize': 'error',
  'image.missingFields': 'error',
  'matte.noSource': 'error',
  'matte.sourceFlag': 'error',
  'matte.hiddenSource': 'error',
  'matte.notAdjacent': 'error',
  'matte.canvasLookup': 'error',
  'matte.orphan': 'warning',
  'matte.explicitVisible': 'warning',
  'mask.flag': 'error',
  'mask.fields': 'error',
  'mask.keyOrder': 'warning',
  'effect.disabled': 'warning',
  'effect.keyOrder': 'warning',
  'layer.keyOrder3d': 'warning',
  'text.noFonts': 'error',
  'text.emptyChars': 'error',
  'text.unknownFont': 'warning',
  'text.missingGlyphs': 'warning',
  'text.newline': 'warning',
  'telegram.size': 'error',
  'telegram.fps': 'error',
  'telegram.duration': 'error',
  'telegram.fileSize': 'error',
  compat: 'warning',
  'layer.parentMissing': 'warning',
  'layer.missingInd': 'warning',
  'layer.stretchZero': 'warning',
  'layer.neverVisible': 'warning',
  'shape.vertexCount': 'warning',
  'image.external': 'warning',
  'image.huge': 'warning',
  'image.aspect': 'warning',
  'image.oversized': 'info',
  'shape.emptyLayer': 'info',
  'asset.unused': 'info',
  'prop.legacyKeyframes': 'info',
  'doc.legacyVersion': 'info',
  'perf.fileSize': 'warning',
  'perf.layers': 'warning',
  'perf.masks': 'warning',
  'perf.keyframes': 'warning',
  'perf.frames': 'info',
  'perf.canvas': 'warning',
}

const WEB: PlatformImpact[] = [
  { player: 'web-svg', level: 'x' },
  { player: 'web-canvas', level: 'x' },
  { player: 'web-html', level: 'x' },
]
const TELEGRAM: PlatformImpact[] = [{ player: 'telegram', level: 'x' }]
/** Players that read these fields with strict integer / boolean parsers. */
const STRICT_INT: PlatformImpact[] = [
  { player: 'android', level: 'x' },
  { player: 'thorvg', level: 'x' },
]
const STRICT_BOOL: PlatformImpact[] = [
  { player: 'android', level: 'x' },
  { player: 'thorvg', level: 'x' },
  { player: 'skottie', level: 'n' },
]
/** Integer fields whose rounding cannot change the rendering (sizes, indices rounded consistently). */
const SAFE_ROUNDING = new Set(['ind', 'parent', 'tp', 'w', 'h', 'sw', 'sh', 'tr'])

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
const CODE_RANK = new Map<IssueCode, number>(ISSUE_CODES.map((c, i) => [c, i]))
const FEATURE_RANK = new Map<string, number>(FEATURE_IDS.map((f, i) => [f, i]))

/** At most this many occurrence paths are kept per issue. */
const MAX_PATHS = 5000

/* -------------------------------------------------------------------------- */
/*                                  Collector                                 */
/* -------------------------------------------------------------------------- */

interface AddOptions {
  params?: IssueParams
  platforms?: PlatformImpact[]
  fix?: FixId
  safe?: boolean
  severity?: Severity
  /** Occurrences represented by the given paths (defaults to the number of paths). */
  count?: number
}

function paramsKey(params: IssueParams): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
}

class Collector {
  private readonly groups = new Map<string, Issue>()

  add(code: IssueCode, where: NodePath | NodePath[], opts: AddOptions = {}): void {
    const paths =
      where.length > 0 && Array.isArray(where[0]) ? (where as NodePath[]) : [where as NodePath]
    const params = opts.params ?? {}
    const players = opts.platforms?.map((p) => `${p.player}:${p.level}`).join(',') ?? ''
    const id = `${code}|${paramsKey(params)}|${players}|${opts.fix ?? ''}|${opts.safe ? 1 : 0}`
    let issue = this.groups.get(id)
    if (!issue) {
      const severity =
        opts.severity ??
        (opts.platforms?.length
          ? (severityFor(worstLevel(opts.platforms.map((p) => p.level))) ?? 'info')
          : BASE_SEVERITY[code])
      issue = { id, severity, code, params, paths: [], count: 0 }
      if (opts.platforms?.length) issue.platforms = opts.platforms
      if (opts.fix) {
        issue.fix = opts.fix
        issue.safe = opts.safe === true
      }
      this.groups.set(id, issue)
    }
    for (const p of paths) if (issue.paths.length < MAX_PATHS) issue.paths.push(p)
    issue.count += opts.count ?? paths.length
  }

  finish(): Issue[] {
    return sortIssues([...this.groups.values()])
  }
}

/** Sorts issues: severity, then code order, then feature order, then location. */
export function sortIssues(issues: Issue[]): Issue[] {
  const firstKey = (i: Issue) => (i.paths[0] ? pathKey(i.paths[0]) : '')
  return issues.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (CODE_RANK.get(a.code) ?? 0) - (CODE_RANK.get(b.code) ?? 0) ||
      (FEATURE_RANK.get(String(a.params.feature)) ?? 0) -
        (FEATURE_RANK.get(String(b.params.feature)) ?? 0) ||
      firstKey(a).localeCompare(firstKey(b)),
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

const isFrac = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v)

function isKeyframeList(k: unknown): k is Json[] {
  return Array.isArray(k) && k.length > 0 && isObj(k[0]) && typeof k[0].t === 'number'
}

/**
 * Entries of a keyframe list that are not keyframes: not objects, or without a time (a null
 * time is reported as an invalid number instead). Players fail on the whole property.
 */
function damagedKeyframes(k: readonly unknown[]): number[] {
  const out: number[] = []
  k.forEach((kf, i) => {
    if (!isObj(kf) || (typeof kf.t !== 'number' && kf.t !== null)) out.push(i)
  })
  return out
}

function versionParts(v: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** a < b for dotted versions. */
function versionLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

function pathValue(v: unknown): Json | null {
  return isObj(v) && Array.isArray(v.v) ? v : null
}

/** Bezier values of a path property (static value or every keyframe value). */
function bezierValues(prop: Json): { value: Json | null; path: NodePath }[] {
  const k = prop.k
  if (isKeyframeList(k)) {
    const out: { value: Json | null; path: NodePath }[] = []
    k.forEach((kf, i) => {
      if (!isObj(kf)) return
      if (Array.isArray(kf.s)) out.push({ value: pathValue(kf.s[0]), path: ['k', i, 's', 0] })
      if (Array.isArray(kf.e)) out.push({ value: pathValue(kf.e[0]), path: ['k', i, 'e', 0] })
    })
    return out
  }
  return [{ value: pathValue(k), path: ['k'] }]
}

function isPoint(p: unknown): boolean {
  return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
}

/** 'ok', 'tangents' (only i/o are wrong, repairable) or 'broken'. */
function bezierHealth(b: Json | null): 'ok' | 'tangents' | 'broken' {
  if (!b || !Array.isArray(b.v) || !b.v.every(isPoint)) return 'broken'
  const n = b.v.length
  const good = (list: unknown) => Array.isArray(list) && list.length === n && list.every(isPoint)
  return good(b.i) && good(b.o) ? 'ok' : 'tangents'
}

/** Keys required on shape items (lottie-web fails to build the item without them). */
const REQUIRED_SHAPE_KEYS: Record<string, readonly string[]> = {
  sh: ['ks'],
  rc: ['p', 's', 'r'],
  el: ['p', 's'],
  sr: ['p', 'or', 'os', 'pt', 'r'],
  fl: ['c', 'o'],
  st: ['c', 'o', 'w'],
  gf: ['g', 's', 'e', 'o'],
  gs: ['g', 's', 'e', 'o', 'w'],
  tm: ['s', 'e', 'o'],
  rp: ['c', 'o', 'tr'],
  rd: ['r'],
}

/** Defaults for required keys the fix can add without guessing (the preview adds the same). */
function defaultFor(ty: unknown, key: string): Json | null {
  if (ty === 'rc' && key === 'r') return { a: 0, k: 0 }
  if ((ty === 'fl' || ty === 'st') && key === 'c') return { a: 0, k: [0, 0, 0, 1] }
  if ((ty === 'fl' || ty === 'st') && key === 'o') return { a: 0, k: 100 }
  if (ty === 'st' && key === 'w') return { a: 0, k: 1 }
  return null
}

/** Integer fields of shape items (enums; rounding them changes their meaning). */
const SHAPE_INT_FIELDS: Record<string, readonly string[]> = {
  sr: ['sy', 'd'],
  tm: ['m'],
  fl: ['r'],
  gf: ['r', 't'],
  st: ['lc', 'lj'],
  gs: ['lc', 'lj', 't'],
  sh: ['d'],
  rc: ['d'],
  el: ['d'],
}

function hasGeometry(items: unknown): boolean {
  for (const it of arr(items)) {
    if (!isObj(it)) continue
    if (it.ty === 'sh' || it.ty === 'rc' || it.ty === 'el' || it.ty === 'sr') return true
    if (it.ty === 'gr' && hasGeometry(it.it)) return true
  }
  return false
}

/* -------------------------------------------------------------------------- */
/*                                    Rules                                   */
/* -------------------------------------------------------------------------- */

function checkDocument(anim: Animation, c: Collector, ctx: ValidateContext): void {
  const root = anim as unknown as Json
  const fr = root.fr
  if (!(typeof fr === 'number' && Number.isFinite(fr) && fr > 0))
    c.add('doc.frameRate', [], { params: { value: String(fr) } })
  const ip = num(root.ip)
  const op = num(root.op)
  if (ip === undefined || op === undefined || op <= ip) c.add('doc.range', [])
  const w = num(root.w)
  const h = num(root.h)
  if (!(w !== undefined && h !== undefined && w > 0 && h > 0)) c.add('doc.size', [])
  for (const field of ['w', 'h'] as const) {
    if (isFrac(root[field]))
      c.add('value.notInteger', [field], {
        params: { field },
        platforms: STRICT_INT,
        fix: 'roundIntegers',
        safe: true,
      })
  }

  const v = root.v
  if (typeof v !== 'string') {
    c.add('doc.version', [], {
      platforms: [{ player: 'ios', level: 'x' }],
      fix: 'setVersion',
      safe: true,
    })
  } else {
    const parts = versionParts(v)
    if (!parts) {
      c.add('doc.version', [], {
        params: { value: v },
        platforms: [{ player: 'android', level: 'x' }],
        fix: 'setVersion',
        safe: true,
      })
    } else if (parts[0] < 5) {
      const legacyColors = versionLess(parts, [4, 1, 9])
      c.add('doc.legacyVersion', [], {
        params: { version: v, colors: legacyColors ? 1 : 0 },
        severity: legacyColors ? 'warning' : 'info',
      })
    }
  }

  if (w !== undefined && h !== undefined && (w > LIMITS.canvas || h > LIMITS.canvas)) {
    c.add('perf.canvas', [], { params: { width: w, height: h } })
  }
  const frames = ip !== undefined && op !== undefined ? op - ip : 0
  if (frames >= LIMITS.frames) c.add('perf.frames', [], { params: { frames: Math.round(frames) } })
  if (ctx.rawBytes !== undefined && ctx.rawBytes >= LIMITS.fileBytes) {
    c.add('perf.fileSize', [], { params: { bytes: ctx.rawBytes } })
  }

  // Telegram animated stickers.
  if (w !== LIMITS.telegramSize || h !== LIMITS.telegramSize) {
    c.add('telegram.size', [], { params: { width: w ?? 0, height: h ?? 0 }, platforms: TELEGRAM })
  }
  if (typeof fr === 'number' && fr !== LIMITS.telegramFps)
    c.add('telegram.fps', [], { params: { fps: fr }, platforms: TELEGRAM })
  if (typeof fr === 'number' && fr > 0 && frames / fr > LIMITS.telegramSeconds + 1e-6) {
    c.add('telegram.duration', [], {
      params: { seconds: Math.round((frames / fr) * 100) / 100 },
      platforms: TELEGRAM,
    })
  }
  if (ctx.gzipBytes !== undefined && ctx.gzipBytes > LIMITS.telegramBytes) {
    c.add('telegram.fileSize', [], { params: { bytes: ctx.gzipBytes }, platforms: TELEGRAM })
  }
}

function isReferenced(comp: CompRef, ind: unknown): boolean {
  return (
    typeof ind === 'number' && comp.layers.some((r) => r.layer.parent === ind || r.layer.tp === ind)
  )
}

function checkComposition(comp: CompRef, c: Collector): void {
  const layers = comp.layers.map((r) => r.layer)
  const byInd = new Map<number, LayerRef[]>()
  for (const ref of comp.layers) {
    const ind = ref.layer.ind
    if (typeof ind !== 'number' || !Number.isFinite(ind)) {
      c.add('layer.missingInd', ref.path, { fix: 'assignInd', safe: true })
      continue
    }
    const list = byInd.get(ind)
    if (list) list.push(ref)
    else byInd.set(ind, [ref])
  }
  for (const [ind, refs] of byInd) {
    if (refs.length < 2) continue
    c.add(
      'layer.duplicateInd',
      refs.map((r) => r.path),
      { params: { ind }, fix: 'renumberInd', safe: !isReferenced(comp, ind) },
    )
  }

  for (const ref of comp.layers) {
    const parent = ref.layer.parent
    if (parent === undefined || parent === null) continue
    if (typeof parent !== 'number' || !byInd.has(parent)) {
      c.add('layer.parentMissing', ref.path, {
        params: { ind: String(parent) },
        fix: 'removeParent',
        safe: true,
      })
    }
  }
  for (const cycle of findParentCycles(layers)) {
    c.add(
      'layer.parentCycle',
      cycle.map((i) => comp.layers[i].path),
      { fix: 'breakParentCycle', safe: true, count: 1 },
    )
  }

  // Track mattes: resolve the source as lottie-web SVG does, then check what other players do.
  const consumers = Array.from({ length: layers.length }, () => 0)
  layers.forEach((layer, i) => {
    const tt = num(layer.tt) ?? 0
    if (tt <= 0) return
    const ref = comp.layers[i]
    const hasTp = typeof layer.tp === 'number'
    const src = hasTp ? layers.findIndex((l) => l.ind === layer.tp) : i - 1
    if (src < 0) {
      c.add('matte.noSource', ref.path, { params: { reason: hasTp ? 'parent' : 'first' } })
      return
    }
    consumers[src]++
    const source = layers[src]
    const sourcePath = comp.layers[src].path
    if (source.td !== 1) {
      if (source.td === true || (typeof source.td === 'number' && source.td !== 0)) {
        // Truthy but not 1: SVG hides it, the canvas renderer draws it.
        c.add('matte.sourceFlag', sourcePath, {
          params: { state: 'value' },
          platforms: [{ player: 'web-canvas', level: 'x' }],
          fix: 'flagMatteSource',
          safe: true,
        })
      } else {
        c.add('matte.sourceFlag', sourcePath, {
          params: { state: 'missing' },
          fix: 'flagMatteSource',
          safe: false,
        })
      }
    }
    if (source.hd === true)
      c.add('matte.hiddenSource', sourcePath, { fix: 'unhideMatteSource', safe: false })
    else if (source.hd === false && source.td) {
      c.add('matte.explicitVisible', sourcePath, {
        platforms: [{ player: 'skottie', level: 'x' }],
        fix: 'dropVisibleFlag',
        safe: true,
      })
    }
    if (hasTp && src !== i - 1) {
      // Offered only when nothing else relies on the source's position.
      const shared = layers.some((l, j) => j !== i && l.tp === layer.tp)
      c.add('matte.notAdjacent', ref.path, {
        platforms: [
          { player: 'android', level: 'x' },
          { player: 'ios', level: 'x' },
        ],
        ...(shared ? {} : { fix: 'moveMatteSource' as const, safe: false }),
      })
    }
    if (!hasTp) {
      const ind = num(layer.ind)
      const prevInd = num(layers[i - 1]?.ind)
      if (ind === undefined || prevInd !== ind - 1) {
        c.add('matte.canvasLookup', ref.path, {
          platforms: [{ player: 'web-canvas', level: 'x' }],
          ...(prevInd !== undefined ? { fix: 'setMatteParent' as const, safe: true } : {}),
        })
      }
    }
  })
  layers.forEach((layer, i) => {
    if (!(layer.td === 1 || layer.td === true) || consumers[i] > 0) return
    // An unused matte layer adjacent to a later matted layer is consumed by adjacency players.
    const next = layers[i + 1]
    if (next && (num(next.tt) ?? 0) > 0) return
    const removable = !isReferenced(comp, layer.ind)
    c.add('matte.orphan', comp.layers[i].path, {
      platforms: [
        { player: 'android', level: 'x' },
        { player: 'ios', level: 'x' },
      ],
      ...(removable ? { fix: 'removeOrphanMatte' as const, safe: true } : {}),
    })
  })
}

interface TextContext {
  fontNames: Set<string>
  fonts: Json[]
  chars: Json[] | null
  noFontPaths: NodePath[]
}

function checkText(ref: LayerRef, c: Collector, text: TextContext): void {
  const t = isObj(ref.layer.t) ? ref.layer.t : null
  const d = t && isObj(t.d) ? t.d : null
  const docPath = [...ref.path, 't', 'd']
  if (!text.fonts.length) text.noFontPaths.push(ref.path)
  arr(d?.k).forEach((kf, i) => {
    if (!isObj(kf) || !isObj(kf.s)) return
    const doc = kf.s
    const f = doc.f
    if (text.fonts.length && typeof f === 'string' && !text.fontNames.has(f)) {
      c.add('text.unknownFont', docPath, { params: { font: f } })
    }
    const content = typeof doc.t === 'string' ? doc.t : ''
    if (content.includes('\n')) {
      c.add('text.newline', docPath, {
        platforms: [
          { player: 'web-svg', level: 'n' },
          { player: 'web-canvas', level: 'n' },
          { player: 'web-html', level: 'n' },
        ],
        fix: 'lineBreaks',
        safe: true,
      })
    }
    if (isFrac(doc.tr)) {
      c.add('value.notInteger', [...docPath, 'k', i, 's', 'tr'], {
        params: { field: 'tr' },
        platforms: [{ player: 'ios', level: 'x' }],
        fix: 'roundIntegers',
        safe: true,
      })
    }
    if (isFrac(doc.j)) {
      c.add('value.notInteger', [...docPath, 'k', i, 's', 'j'], {
        params: { field: 'j' },
        platforms: STRICT_INT,
        fix: 'roundIntegers',
      })
    }
    // Glyph mode: once `chars` exists, lottie-web and lottie-android draw only embedded glyphs.
    if (text.chars && text.chars.length > 0 && content) {
      const font = text.fonts.find((fo) => fo.fName === f)
      const family = font?.fFamily
      const style = font?.fStyle
      const available = new Set(
        text.chars.filter((ch) => ch.fFamily === family && ch.style === style).map((ch) => ch.ch),
      )
      const missing: string[] = []
      for (const ch of new Set(content))
        if (!LINE_BREAKS.has(ch) && !available.has(ch)) missing.push(ch)
      if (missing.length) {
        c.add('text.missingGlyphs', docPath, {
          params: { font: String(family ?? f ?? ''), chars: missing.slice(0, 16).join('') },
          platforms: [...WEB, { player: 'android', level: 'x' }],
        })
      }
    }
  })
}

function checkLayer(
  anim: Animation,
  ref: LayerRef,
  c: Collector,
  text: TextContext,
  assetsById: Map<string, Json>,
): void {
  const { layer, path, comp } = ref
  const ty = layer.ty

  for (const field of [
    'ty',
    'ind',
    'parent',
    'tp',
    'tt',
    'bm',
    'ao',
    'ddd',
    'sw',
    'sh',
    'w',
    'h',
  ] as const) {
    if (isFrac(layer[field])) {
      c.add('value.notInteger', [...path, field], {
        params: { field },
        platforms: STRICT_INT,
        fix: 'roundIntegers',
        safe: SAFE_ROUNDING.has(field),
      })
    }
  }
  if (layer.hd !== undefined && typeof layer.hd !== 'boolean') {
    c.add('value.notBoolean', [...path, 'hd'], {
      params: { field: 'hd' },
      platforms: STRICT_BOOL,
      fix: 'toBoolean',
      safe: true,
    })
  }

  // Timing
  const hasIp = typeof layer.ip === 'number'
  const hasOp = typeof layer.op === 'number'
  if (!hasIp || !hasOp) c.add('layer.missingInOut', path, { fix: 'addInOut', safe: false })
  if (typeof layer.st !== 'number')
    c.add('layer.missingStart', path, { fix: 'addStart', safe: true })
  if (hasIp && hasOp) {
    if ((layer.op as number) <= (layer.ip as number))
      c.add('layer.neverVisible', path, { params: { reason: 'empty' } })
    else if (comp.reachable && !isLayerEverVisible(anim, ref))
      c.add('layer.neverVisible', path, { params: { reason: 'outside' } })
  }
  if (layer.sr === 0) c.add('layer.stretchZero', path, { fix: 'resetStretch', safe: true })

  // Transform
  const ks = layer.ks
  if (!isObj(ks)) {
    c.add('layer.missingTransform', path, { fix: 'addTransform', safe: true })
  } else {
    if ('rx' in ks && !('ry' in ks && 'rz' in ks && 'or' in ks)) {
      c.add('prop.incomplete3d', [...path, 'ks'], { platforms: WEB, fix: 'complete3d', safe: true })
    }
    if (isObj(ks.p) && ks.p.s === true && !(isObj(ks.p.x) && isObj(ks.p.y)))
      c.add('prop.splitPosition', [...path, 'ks', 'p'])
  }
  const keys = Object.keys(layer)
  if (layer.ddd === 1 && keys.includes('ks') && keys.indexOf('ddd') > keys.indexOf('ks')) {
    c.add('layer.keyOrder3d', path, {
      platforms: [{ player: 'thorvg', level: 'x' }],
      fix: 'reorderKeys',
      safe: true,
    })
  }

  // Assets
  if (ty === 0 || ty === 2) {
    const asset = typeof layer.refId === 'string' ? assetsById.get(layer.refId) : undefined
    const kindOk = asset && (ty === 0 ? Array.isArray(asset.layers) : !Array.isArray(asset.layers))
    if (!kindOk)
      c.add('asset.missing', path, {
        params: { id: String(layer.refId ?? ''), kind: ty === 0 ? 'precomp' : 'image' },
      })
  }
  if (ty === 0 && (typeof layer.w !== 'number' || typeof layer.h !== 'number')) {
    c.add('precomp.missingSize', path, {
      platforms: [
        { player: 'web-svg', level: 'x' },
        { player: 'ios', level: 'x' },
      ],
      fix: 'addPrecompSize',
      safe: false,
    })
  }

  // Masks
  const masks = arr(layer.masksProperties)
  if (masks.length > 0 && layer.hasMask !== true)
    c.add('mask.flag', path, { platforms: WEB, fix: 'setHasMask', safe: true })
  masks.forEach((m, mi) => {
    if (!isObj(m)) return
    const mp = [...path, 'masksProperties', mi]
    if (m.o === undefined || m.x === undefined || typeof m.mode !== 'string')
      c.add('mask.fields', mp, { fix: 'completeMask', safe: true })
    if (m.pt === undefined) c.add('prop.missing', [...mp, 'pt'], { params: { key: 'pt' } })
    if (m.inv !== undefined && typeof m.inv !== 'boolean') {
      c.add('value.notBoolean', [...mp, 'inv'], {
        params: { field: 'inv' },
        platforms: STRICT_BOOL,
        fix: 'toBoolean',
        safe: true,
      })
    }
    const mk = Object.keys(m)
    if (m.inv === true && mk.includes('mode') && mk.indexOf('inv') > mk.indexOf('mode')) {
      c.add('mask.keyOrder', mp, {
        platforms: [{ player: 'thorvg', level: 'x' }],
        fix: 'reorderKeys',
        safe: true,
      })
    }
  })

  // Effects
  arr(layer.ef).forEach((e, ei) => {
    if (!isObj(e)) return
    const ep = [...path, 'ef', ei]
    if (e.ty !== 5) {
      if (e.en === 0) {
        c.add('effect.disabled', ep, {
          params: { state: 'off' },
          platforms: [{ player: 'thorvg', level: 'n' }],
          fix: 'removeDisabledEffect',
          safe: false,
        })
      } else if (e.en === undefined) {
        c.add('effect.disabled', ep, {
          params: { state: 'missing' },
          platforms: [{ player: 'thorvg', level: 'n' }],
          fix: 'enableEffect',
          safe: true,
        })
      }
    }
    const ek = Object.keys(e)
    if (ek.includes('ef') && ek.includes('ty') && ek.indexOf('ty') > ek.indexOf('ef')) {
      c.add('effect.keyOrder', ep, {
        platforms: [{ player: 'thorvg', level: 'x' }],
        fix: 'reorderKeys',
        safe: true,
      })
    }
  })

  if (ty === 5) checkText(ref, c, text)

  if (ty === 4) {
    if (!Array.isArray(layer.shapes))
      c.add('shape.missingShapes', path, { fix: 'addShapes', safe: true })
    else if (!hasGeometry(layer.shapes) && !layer.td && !isReferenced(comp, layer.ind))
      c.add('shape.emptyLayer', path)
  }
}

function checkShapes(anim: Animation, c: Collector): void {
  for (const { item, path } of scanDocument(anim).shapes) {
    const ty = item.ty
    if (item.hd !== undefined && typeof item.hd !== 'boolean') {
      c.add('value.notBoolean', [...path, 'hd'], {
        params: { field: 'hd' },
        platforms: STRICT_BOOL,
        fix: 'toBoolean',
        safe: true,
      })
    }
    for (const field of typeof ty === 'string' ? (SHAPE_INT_FIELDS[ty] ?? []) : []) {
      if (isFrac(item[field]))
        c.add('value.notInteger', [...path, field], {
          params: { field },
          platforms: STRICT_INT,
          fix: 'roundIntegers',
        })
    }
    if (ty === 'gr') {
      if (!Array.isArray(item.it)) {
        c.add('shape.groupNoItems', path, { fix: 'addGroupItems', safe: true })
      } else {
        const trs = item.it.flatMap((it, i) => (isObj(it) && it.ty === 'tr' ? [i] : []))
        if (trs.length === 0) {
          // The default lottie-web build (with expression support) throws on these groups.
          c.add('shape.groupTransform', path, {
            params: { reason: 'missing' },
            platforms: [
              { player: 'web-svg', level: 'x' },
              { player: 'web-canvas', level: 'x' },
            ],
            fix: 'fixGroupTransform',
            safe: true,
          })
        } else if (trs.length > 1 || trs[0] !== item.it.length - 1) {
          c.add('shape.groupTransform', path, {
            params: { reason: trs.length > 1 ? 'multiple' : 'order' },
            fix: 'fixGroupTransform',
            safe: true,
          })
        }
      }
      continue
    }
    if (ty === 'ms') {
      c.add('shape.internal', path, { fix: 'removeItem', safe: true })
      continue
    }
    for (const key of typeof ty === 'string' ? (REQUIRED_SHAPE_KEYS[ty] ?? []) : []) {
      if (item[key] !== undefined) continue
      const fixable = defaultFor(ty, key) !== null
      c.add('prop.missing', [...path, key], {
        params: { key },
        ...(fixable ? { fix: 'addDefaultProperty' as const, safe: true } : {}),
      })
    }
    if ((ty === 'gf' || ty === 'gs') && isObj(item.g) && isObj(item.g.k)) {
      const p = num(item.g.p) ?? 0
      const k = item.g.k.k
      const lists: unknown[][] = isKeyframeList(k)
        ? k.flatMap((kf) => (isObj(kf) ? ([kf.s, kf.e].filter(Array.isArray) as unknown[][]) : []))
        : Array.isArray(k)
          ? [k]
          : []
      const bad = lists.some((values) => values.length < p * 4 || (values.length - p * 4) % 2 !== 0)
      if (bad) c.add('gradient.stops', path)
    }
  }
}

/** Characters that break lines (and AE's end-of-text marker): they need no glyph. */
const LINE_BREAKS = new Set(['\r', '\n', String.fromCharCode(3)])

const bad = (v: unknown): boolean => v === null || (typeof v === 'number' && !Number.isFinite(v))

/** Finds null / NaN / Infinity numbers in a property value (paths relative to the property). */
function badNumbers(prop: Json): NodePath[] {
  const out: NodePath[] = []
  const checkList = (list: unknown, base: NodePath) => {
    if (!Array.isArray(list)) return
    list.forEach((v, i) => {
      if (bad(v)) out.push([...base, i])
      else if (Array.isArray(v)) checkList(v, [...base, i])
      else if (isObj(v) && Array.isArray(v.v)) checkBezier(v, [...base, i])
    })
  }
  const checkBezier = (b: Json, base: NodePath) => {
    for (const key of ['v', 'i', 'o'] as const) checkList(b[key], [...base, key])
  }
  const checkHandle = (h: unknown, base: NodePath) => {
    if (!isObj(h)) return
    for (const key of ['x', 'y'] as const) {
      const v = h[key]
      if (bad(v)) out.push([...base, key])
      else checkList(v, [...base, key])
    }
  }
  const k = prop.k
  if (isKeyframeList(k)) {
    k.forEach((kf, i) => {
      if (!isObj(kf)) return
      if (bad(kf.t)) out.push(['k', i, 't'])
      for (const key of ['s', 'e', 'to', 'ti'] as const) {
        if (bad(kf[key])) out.push(['k', i, key])
        else checkList(kf[key], ['k', i, key])
      }
      checkHandle(kf.i, ['k', i, 'i'])
      checkHandle(kf.o, ['k', i, 'o'])
    })
  } else if (bad(k)) out.push(['k'])
  else if (Array.isArray(k)) checkList(k, ['k'])
  else if (isObj(k) && Array.isArray(k.v)) checkBezier(k, ['k'])
  return out
}

function checkProperties(anim: Animation, c: Collector): void {
  for (const { prop, path, kind } of scanDocument(anim).properties) {
    const invalid = badNumbers(prop)
    if (invalid.length)
      c.add(
        'value.nonFinite',
        invalid.map((p) => [...path, ...p]),
        { fix: 'zeroNonFinite', safe: false },
      )
    const k = prop.k
    const damaged = isKeyframeList(k) ? damagedKeyframes(k) : []
    if (damaged.length) {
      // The other keyframe checks assume keyframe objects; the fix comes first.
      c.add(
        'prop.badKeyframe',
        damaged.map((i) => [...path, 'k', i]),
        { fix: 'removeBadKeyframes', safe: true },
      )
      continue
    }
    if (kind === 'text') continue

    if (isKeyframeList(k)) {
      if (k.length === 1) {
        c.add('prop.singleKeyframe', path, { platforms: WEB, fix: 'makeStatic', safe: true })
      } else {
        if (prop.a === 0)
          c.add('prop.animatedFlag', path, {
            platforms: [{ player: 'skottie', level: 'x' }],
            fix: 'syncAnimatedFlag',
            safe: true,
          })
        for (let i = 1; i < k.length; i++) {
          if (typeof k[i].t === 'number' && (k[i].t as number) < (k[i - 1].t as number)) {
            c.add('prop.unsorted', path, { fix: 'sortKeyframes', safe: true })
            break
          }
        }
        for (let i = 0; i < k.length - 1; i++) {
          const kf = k[i]
          if (kf.h === 1 || kf.h === true) continue
          if (!isObj(kf.o) || !isObj(kf.i)) {
            c.add('prop.missingEasing', path, { platforms: WEB, fix: 'addEasing', safe: true })
            break
          }
        }
        if (k.some((kf) => 'e' in kf))
          c.add('prop.legacyKeyframes', path, { fix: 'upgradeKeyframes', safe: true })
      }
    } else if (prop.a === 1) {
      c.add('prop.animatedFlag', path, { platforms: WEB, fix: 'syncAnimatedFlag', safe: true })
    }

    if (kind === 'path') {
      const values = bezierValues(prop)
      const health = values.map((b) => bezierHealth(b.value))
      if (health.some((h) => h !== 'ok')) {
        const repairable = health.every((h) => h !== 'broken')
        c.add('shape.pathMalformed', path, repairable ? { fix: 'repairPath', safe: true } : {})
      } else if (values.length > 1) {
        const counts = new Set(values.map((b) => arr(b.value?.v).length))
        if (counts.size > 1) c.add('shape.vertexCount', path)
      }
    }
  }
}

function checkAssets(anim: Animation, c: Collector): Map<string, Json> {
  const root = anim as unknown as Json
  const scan = scanDocument(anim)
  const assetsById = new Map<string, Json>()
  const seen = new Map<string, number>()
  arr(root.assets).forEach((a, i) => {
    if (!isObj(a)) return
    const id = String(a.id ?? '')
    if (seen.has(id))
      c.add('asset.duplicateId', ['assets', i], {
        params: { id },
        fix: 'renameDuplicateAsset',
        safe: true,
      })
    else {
      seen.set(id, i)
      assetsById.set(id, a)
    }
  })
  for (const id of findPrecompCycles(anim)) {
    const index = seen.get(id)
    if (index !== undefined) c.add('asset.cycle', ['assets', index], { params: { id } })
  }

  // Images used by layers of rendered compositions.
  const usedImages = new Set<string>()
  for (const comp of scan.comps) {
    if (!comp.reachable) continue
    for (const { layer } of comp.layers)
      if (layer.ty === 2 && typeof layer.refId === 'string') usedImages.add(layer.refId)
  }
  const unused: NodePath[] = []
  arr(root.assets).forEach((a, i) => {
    if (!isObj(a)) return
    const id = String(a.id ?? '')
    if (Array.isArray(a.layers)) {
      const comp = scan.comps.find((cp) => cp.assetIndex === i)
      if (comp && !comp.reachable) unused.push(['assets', i])
      return
    }
    if (typeof a.p !== 'string') {
      if (!('p' in a) && !('u' in a)) return // not an image (audio, data, …)
      c.add('image.missingFields', ['assets', i], { platforms: [{ player: 'ios', level: 'x' }] })
      return
    }
    if (!usedImages.has(id) && seen.get(id) === i) unused.push(['assets', i])

    const info = inspectDataUri(a.p)
    const missingU = typeof a.u !== 'string'
    const missingSize = typeof a.w !== 'number' || typeof a.h !== 'number'
    if (missingU || missingSize) {
      const fixable = !missingSize || (info?.width !== undefined && info.height !== undefined)
      c.add('image.missingFields', ['assets', i], {
        platforms: [{ player: 'ios', level: 'x' }],
        ...(fixable ? { fix: 'completeImage' as const, safe: !missingSize } : {}),
      })
    }
    if (!info) {
      if (a.e !== 1) {
        const url = /^(https?:)?\/\//i.test(`${typeof a.u === 'string' ? a.u : ''}${a.p}`)
        c.add('image.external', ['assets', i], { params: { kind: url ? 'url' : 'file' } })
      }
      return
    }
    if (info.bytes > LIMITS.imageBytes)
      c.add('image.huge', ['assets', i], { params: { bytes: info.bytes } })
    const w = num(a.w)
    const h = num(a.h)
    if (info.width && info.height && w && h) {
      const declared = w / h
      const actual = info.width / info.height
      if (Math.abs(declared / actual - 1) > 0.01) {
        c.add('image.aspect', ['assets', i], {
          params: { declared: `${w} × ${h}`, actual: `${info.width} × ${info.height}` },
        })
      } else if (info.width > w * 2.05 && info.height > h * 2.05 && info.bytes > 100 * 1024) {
        c.add('image.oversized', ['assets', i], {
          params: { declared: `${w} × ${h}`, actual: `${info.width} × ${info.height}` },
        })
      }
    }
  })
  if (unused.length) c.add('asset.unused', unused, { fix: 'removeUnusedAssets', safe: true })
  return assetsById
}

function checkFeatures(anim: Animation, c: Collector): void {
  const hits = detectFeatures(anim)
  const scan = scanDocument(anim)
  for (const id of FEATURE_IDS) {
    const hit = hits.get(id)
    if (!hit) continue
    const platforms = affectedPlayers(id) as PlatformImpact[]
    if (!platforms.length) continue
    let fix: Pick<AddOptions, 'fix' | 'safe'> = {}
    if (id === 'expressions') fix = { fix: 'removeExpressions', safe: false }
    if (id === 'layer.camera') {
      const parents = hit.paths.some((p) => {
        const ref = scan.layers.find((l) => pathKey(l.path) === pathKey(p))
        return !!ref && isReferenced(ref.comp, ref.layer.ind)
      })
      fix = { fix: 'removeCameras', safe: !parents }
    }
    c.add('compat', hit.paths, { params: { feature: id }, platforms, count: hit.count, ...fix })
  }
}

/**
 * Validates a document. `ctx` adds checks that need the serialized size (file size limits).
 * Issues are sorted by severity (for "all players") and code order.
 */
export function validate(anim: Animation, ctx: ValidateContext = {}): Issue[] {
  const c = new Collector()
  const root = anim as unknown as Json
  const scan = scanDocument(anim)

  checkDocument(anim, c, ctx)
  const assetsById = checkAssets(anim, c)

  const fonts = arr(isObj(root.fonts) ? root.fonts.list : undefined).filter(isObj)
  const text: TextContext = {
    fonts,
    fontNames: new Set(fonts.map((f) => String(f.fName))),
    chars: Array.isArray(root.chars) ? root.chars.filter(isObj) : null,
    noFontPaths: [],
  }
  for (const comp of scan.comps) checkComposition(comp, c)
  for (const ref of scan.layers) checkLayer(anim, ref, c, text, assetsById)
  if (text.noFontPaths.length) c.add('text.noFonts', text.noFontPaths)
  if (
    Array.isArray(root.chars) &&
    root.chars.length === 0 &&
    scan.layers.some((l) => l.layer.ty === 5)
  ) {
    c.add('text.emptyChars', ['chars'], { fix: 'removeChars', safe: false })
  }
  checkShapes(anim, c)
  checkProperties(anim, c)
  checkFeatures(anim, c)

  // Performance
  if (scan.layers.length >= LIMITS.layers)
    c.add('perf.layers', [], { params: { count: scan.layers.length } })
  const masks = scan.layers.reduce((n, l) => n + arr(l.layer.masksProperties).length, 0)
  if (masks >= LIMITS.masks) c.add('perf.masks', [], { params: { count: masks } })
  let keyframes = 0
  for (const { prop, kind } of scan.properties)
    if (kind !== 'text' && isKeyframeList(prop.k)) keyframes += prop.k.length
  if (keyframes >= LIMITS.keyframes) c.add('perf.keyframes', [], { params: { count: keyframes } })

  return c.finish()
}

/* -------------------------------------------------------------------------- */
/*                              Targets & summary                             */
/* -------------------------------------------------------------------------- */

/**
 * The issues that matter for a target, re-graded by the worst level among its players.
 * Issues without platforms apply everywhere.
 */
export function issuesForTarget(issues: readonly Issue[], target: TargetId): Issue[] {
  const players = new Set<PlayerId>(TARGETS[target])
  const out: Issue[] = []
  for (const issue of issues) {
    if (!issue.platforms) {
      out.push(issue)
      continue
    }
    const affected = issue.platforms.filter((p) => players.has(p.player))
    if (!affected.length) continue
    const severity = severityFor(worstLevel(affected.map((p) => p.level))) ?? 'info'
    out.push(
      severity === issue.severity && affected.length === issue.platforms.length
        ? issue
        : { ...issue, severity, platforms: affected },
    )
  }
  return sortIssues(out)
}

export interface IssueSummary {
  errors: number
  warnings: number
  infos: number
  /** Issues with a safe automatic fix. */
  fixable: number
}

export function summarizeIssues(issues: readonly Issue[]): IssueSummary {
  const s: IssueSummary = { errors: 0, warnings: 0, infos: 0, fixable: 0 }
  for (const i of issues) {
    if (i.severity === 'error') s.errors++
    else if (i.severity === 'warning') s.warnings++
    else s.infos++
    if (i.fix && i.safe) s.fixable++
  }
  return s
}

/**
 * Worst support level of an issue list per player of a target ('y' when nothing is wrong).
 * Issues without platforms affect every player alike: errors among them break the file in all
 * of them ('x'); warnings and notes (performance, cleanup hints) say nothing about support.
 */
export function playerLevels(issues: readonly Issue[], target: TargetId): Record<PlayerId, Level> {
  const out = {} as Record<PlayerId, Level>
  for (const player of TARGETS[target]) out[player] = 'y'
  for (const issue of issues) {
    let levels: readonly { player: PlayerId; level: Level }[]
    if (issue.platforms) levels = issue.platforms
    else if (issue.severity === 'error')
      levels = TARGETS[target].map((player) => ({ player, level: 'x' as const }))
    else continue
    for (const { player, level } of levels) {
      if (player in out && levelRank(level) > levelRank(out[player])) out[player] = level
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                    Fixes                                   */
/* -------------------------------------------------------------------------- */

type Container = unknown[]

interface FixContext {
  draft: Json
  /** Items to remove by identity once every in-place fix has run. */
  removals: { container: Container; item: unknown }[]
  /** Deferred structural moves (run last). */
  moves: (() => void)[]
}

const identityTransform = (): Json => ({
  ty: 'tr',
  p: { a: 0, k: [0, 0] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
  sk: { a: 0, k: 0 },
  sa: { a: 0, k: 0 },
  nm: 'Transform',
})

const layerTransform = (): Json => ({
  o: { a: 0, k: 100 },
  r: { a: 0, k: 0 },
  p: { a: 0, k: [0, 0, 0] },
  a: { a: 0, k: [0, 0, 0] },
  s: { a: 0, k: [100, 100, 100] },
})

function objAt(draft: Json, path: NodePath): Json | null {
  const v = getAt(draft, path)
  return isObj(v) ? v : null
}

function containerOf(draft: Json, path: NodePath): Container | null {
  const parent = getAt(draft, path.slice(0, -1))
  return Array.isArray(parent) ? parent : null
}

/** Layers array that contains the layer at `path`. */
function compLayers(draft: Json, layerPath: NodePath): Json[] {
  return arr(getAt(draft, layerPath.slice(0, -1))).filter(isObj)
}

function renumber(layers: Json[]): void {
  let max = 0
  for (const l of layers) if (typeof l.ind === 'number' && l.ind > max) max = l.ind
  const seen = new Set<number>()
  for (const l of layers) {
    if (typeof l.ind !== 'number') continue
    if (seen.has(l.ind)) l.ind = ++max
    else seen.add(l.ind)
  }
}

function removeUnused(draft: Json): void {
  const assets = arr(draft.assets)
  const byId = new Map<string, Json>()
  for (const a of assets) if (isObj(a) && !byId.has(String(a.id))) byId.set(String(a.id), a)
  const used = new Set<string>()
  const queue: unknown[][] = [arr(draft.layers)]
  for (const ch of arr(draft.chars)) {
    if (isObj(ch) && isObj(ch.data) && typeof ch.data.refId === 'string') {
      used.add(ch.data.refId)
      const comp = byId.get(ch.data.refId)
      if (comp && Array.isArray(comp.layers)) queue.push(comp.layers)
    }
  }
  while (queue.length) {
    for (const l of queue.shift()!) {
      if (!isObj(l) || typeof l.refId !== 'string' || used.has(l.refId)) continue
      used.add(l.refId)
      const asset = byId.get(l.refId)
      if (asset && Array.isArray(asset.layers)) queue.push(asset.layers)
    }
  }
  // Duplicate ids are kept: renaming them is a separate fix.
  const keep = assets.filter(
    (a) => !isObj(a) || used.has(String(a.id)) || byId.get(String(a.id)) !== a,
  )
  if (keep.length !== assets.length) draft.assets = keep
}

function reorderKeys(o: Json, first: readonly string[]): void {
  const entries = Object.entries(o)
  const head = first.filter((k) => k in o).map((k) => [k, o[k]] as const)
  const tail = entries.filter(([k]) => !first.includes(k))
  for (const [k] of entries) delete o[k]
  for (const [k, v] of [...head, ...tail]) o[k] = v
}

/**
 * Converts legacy keyframes (end values in `e`) to start values on the next keyframe.
 * Values are copied with JSON: they may be immer drafts, which structuredClone rejects.
 */
function upgradeLegacy(prop: Json): void {
  const kfs = arr(prop.k).filter(isObj)
  if (!kfs.some((kf) => 'e' in kf)) return
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i]
    const next = kfs[i + 1]
    if (next && next.s === undefined && kf.e !== undefined)
      next.s = JSON.parse(JSON.stringify(kf.e))
    delete kf.e
  }
}

function staticFromKeyframe(prop: Json): void {
  const kf = arr(prop.k)[0]
  if (!isObj(kf)) return
  const s = kf.s ?? kf.e
  prop.k = Array.isArray(s) && s.length === 1 ? s[0] : (s ?? 0)
  prop.a = 0
}

function addLinearEasing(prop: Json): void {
  const kfs = arr(prop.k).filter(isObj)
  for (let i = 0; i < kfs.length - 1; i++) {
    const kf = kfs[i]
    if (kf.h === 1 || kf.h === true) continue
    const other = isObj(kf.o) ? kf.o : isObj(kf.i) ? kf.i : null
    const dims = other && Array.isArray(other.x) ? other.x.length : 0
    const handle = (v: number) =>
      dims
        ? { x: Array.from({ length: dims }, () => v), y: Array.from({ length: dims }, () => v) }
        : { x: v, y: v }
    if (!isObj(kf.o)) kf.o = handle(0)
    if (!isObj(kf.i)) kf.i = handle(1)
  }
}

function repairBezier(b: Json): void {
  const n = arr(b.v).length
  for (const key of ['i', 'o'] as const) {
    const list = arr(b[key])
    b[key] = Array.from({ length: n }, (_, i) => (isPoint(list[i]) ? list[i] : [0, 0]))
  }
}

function imageFields(asset: Json): void {
  if (typeof asset.u !== 'string') asset.u = ''
  if ((typeof asset.w !== 'number' || typeof asset.h !== 'number') && typeof asset.p === 'string') {
    const info = inspectDataUri(asset.p)
    if (info?.width && info.height) {
      asset.w = info.width
      asset.h = info.height
    }
  }
}

type PathFix = (ctx: FixContext, path: NodePath) => void
type GlobalFix = (ctx: FixContext, paths: readonly NodePath[]) => void

const PATH_FIXES: Partial<Record<FixId, PathFix>> = {
  removeParent: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (!layer) return
    const layers = compLayers(draft, path)
    if (!layers.some((l) => l.ind === layer.parent)) delete layer.parent
  },
  resetStretch: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (layer && layer.sr === 0) layer.sr = 1
  },
  addStart: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (layer && typeof layer.st !== 'number') layer.st = 0
  },
  addInOut: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (!layer) return
    if (typeof layer.ip !== 'number') layer.ip = num(draft.ip) ?? 0
    if (typeof layer.op !== 'number') layer.op = num(draft.op) ?? (layer.ip as number) + 1
  },
  addTransform: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (layer && !isObj(layer.ks)) layer.ks = layerTransform()
  },
  addPrecompSize: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (!layer) return
    const asset = arr(draft.assets).find((a) => isObj(a) && a.id === layer.refId) as
      Json | undefined
    if (typeof layer.w !== 'number') layer.w = num(asset?.w) ?? num(draft.w) ?? 512
    if (typeof layer.h !== 'number') layer.h = num(asset?.h) ?? num(draft.h) ?? 512
  },
  completeImage: ({ draft }, path) => {
    const asset = objAt(draft, path)
    if (asset) imageFields(asset)
  },
  addShapes: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (layer && !Array.isArray(layer.shapes)) layer.shapes = []
  },
  addGroupItems: ({ draft }, path) => {
    const group = objAt(draft, path)
    if (group && !Array.isArray(group.it)) group.it = [identityTransform()]
  },
  fixGroupTransform: ({ draft }, path) => {
    const group = objAt(draft, path)
    if (!group || !Array.isArray(group.it)) return
    const items = group.it as unknown[]
    const trs = items.filter((it) => isObj(it) && it.ty === 'tr')
    const rest = items.filter((it) => !(isObj(it) && it.ty === 'tr'))
    // Players apply the last transform they find.
    group.it = [...rest, trs.length ? trs[trs.length - 1] : identityTransform()]
  },
  repairPath: ({ draft }, path) => {
    const prop = objAt(draft, path)
    if (!prop) return
    for (const { value } of bezierValues(prop))
      if (value && bezierHealth(value) === 'tangents') repairBezier(value)
  },
  removeItem: (ctx, path) => {
    const container = containerOf(ctx.draft, path)
    const item = getAt(ctx.draft, path)
    if (container && item) ctx.removals.push({ container, item })
  },
  addDefaultProperty: ({ draft }, path) => {
    const item = objAt(draft, path.slice(0, -1))
    const key = String(path[path.length - 1])
    const value = item ? defaultFor(item.ty, key) : null
    if (item && value && item[key] === undefined) item[key] = value
  },
  makeStatic: ({ draft }, path) => {
    const prop = objAt(draft, path)
    if (prop && Array.isArray(prop.k) && prop.k.length === 1 && isKeyframeList(prop.k))
      staticFromKeyframe(prop)
  },
  addEasing: ({ draft }, path) => {
    const prop = objAt(draft, path)
    if (prop && isKeyframeList(prop.k)) addLinearEasing(prop)
  },
  sortKeyframes: ({ draft }, path) => {
    const prop = objAt(draft, path)
    if (!prop || !isKeyframeList(prop.k)) return
    upgradeLegacy(prop)
    prop.k = [...(prop.k as Json[])].sort((a, b) => (num(a.t) ?? 0) - (num(b.t) ?? 0))
    // A key that was last may now start a segment: it needs easing like any other.
    addLinearEasing(prop)
  },
  removeBadKeyframes: (ctx, path) => {
    const container = containerOf(ctx.draft, path)
    const index = path[path.length - 1]
    if (!container || typeof index !== 'number' || index >= container.length) return
    const item = container[index]
    if (isObj(item) && typeof item.t === 'number') return
    ctx.removals.push({ container, item })
  },
  syncAnimatedFlag: ({ draft }, path) => {
    const prop = objAt(draft, path)
    if (prop) prop.a = isKeyframeList(prop.k) ? 1 : 0
  },
  upgradeKeyframes: ({ draft }, path) => {
    const prop = objAt(draft, path)
    if (prop && isKeyframeList(prop.k)) upgradeLegacy(prop)
  },
  complete3d: ({ draft }, path) => {
    const ks = objAt(draft, path)
    if (!ks) return
    for (const key of ['rx', 'ry', 'rz'] as const)
      if (ks[key] === undefined) ks[key] = { a: 0, k: 0 }
    if (ks.or === undefined) ks.or = { a: 0, k: [0, 0, 0] }
  },
  zeroNonFinite: ({ draft }, path) => {
    const container = getAt(draft, path.slice(0, -1))
    const key = path[path.length - 1]
    if (container === null || typeof container !== 'object') return
    const record = container as Record<string | number, unknown>
    const v = record[key]
    if (v === null || (typeof v === 'number' && !Number.isFinite(v))) record[key] = 0
  },
  roundIntegers: ({ draft }, path) => {
    const container = getAt(draft, path.slice(0, -1))
    const key = path[path.length - 1]
    if (!isObj(container)) return
    const v = container[key]
    if (isFrac(v)) container[key] = Math.round(v as number)
  },
  toBoolean: ({ draft }, path) => {
    const container = getAt(draft, path.slice(0, -1))
    const key = path[path.length - 1]
    if (isObj(container) && container[key] !== undefined && typeof container[key] !== 'boolean') {
      container[key] = Boolean(container[key])
    }
  },
  setMatteParent: ({ draft }, path) => {
    const layer = objAt(draft, path)
    const layers = compLayers(draft, path)
    const index = layer ? layers.indexOf(layer) : -1
    const prev = layers[index - 1]
    if (layer && prev && typeof prev.ind === 'number' && typeof layer.tp !== 'number')
      layer.tp = prev.ind
  },
  flagMatteSource: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (layer) layer.td = 1
  },
  moveMatteSource: (ctx, path) => {
    const target = objAt(ctx.draft, path)
    const container = containerOf(ctx.draft, path)
    if (!target || !container || typeof target.tp !== 'number') return
    ctx.moves.push(() => {
      const source = container.find((l) => isObj(l) && l.ind === target.tp)
      if (!source || source === target) return
      container.splice(container.indexOf(source), 1)
      container.splice(container.indexOf(target), 0, source)
    })
  },
  removeOrphanMatte: (ctx, path) => {
    const container = containerOf(ctx.draft, path)
    const layer = objAt(ctx.draft, path)
    if (container && layer) ctx.removals.push({ container, item: layer })
  },
  unhideMatteSource: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (layer && layer.hd === true) delete layer.hd
  },
  dropVisibleFlag: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (layer && layer.hd === false) delete layer.hd
  },
  setHasMask: ({ draft }, path) => {
    const layer = objAt(draft, path)
    if (layer && arr(layer.masksProperties).length > 0) layer.hasMask = true
  },
  completeMask: ({ draft }, path) => {
    const mask = objAt(draft, path)
    if (!mask) return
    if (mask.o === undefined) mask.o = { a: 0, k: 100 }
    if (mask.x === undefined) mask.x = { a: 0, k: 0 }
    if (typeof mask.mode !== 'string') mask.mode = 'a'
    if (mask.inv === undefined) mask.inv = false
  },
  reorderKeys: ({ draft }, path) => {
    const o = objAt(draft, path)
    if (!o) return
    const parentKey = path[path.length - 2]
    if (parentKey === 'masksProperties') reorderKeys(o, ['inv', 'mode'])
    else if (parentKey === 'ef') reorderKeys(o, ['ty'])
    else reorderKeys(o, ['ddd'])
  },
  enableEffect: ({ draft }, path) => {
    const effect = objAt(draft, path)
    if (effect && effect.en === undefined) effect.en = 1
  },
  removeDisabledEffect: (ctx, path) => {
    const container = containerOf(ctx.draft, path)
    const effect = objAt(ctx.draft, path)
    if (container && effect && effect.en === 0) ctx.removals.push({ container, item: effect })
  },
  lineBreaks: ({ draft }, path) => {
    const d = objAt(draft, path)
    for (const kf of arr(d?.k)) {
      if (isObj(kf) && isObj(kf.s) && typeof kf.s.t === 'string')
        kf.s.t = kf.s.t.replace(/\r\n|\n/g, '\r')
    }
  },
  removeExpressions: ({ draft }, path) => {
    const prop = objAt(draft, path)
    if (prop && 'x' in prop) delete prop.x
  },
  removeCameras: (ctx, path) => {
    const container = containerOf(ctx.draft, path)
    const layer = objAt(ctx.draft, path)
    if (container && layer && layer.ty === 13) ctx.removals.push({ container, item: layer })
  },
}

const GLOBAL_FIXES: Partial<Record<FixId, GlobalFix>> = {
  setVersion: ({ draft }) => {
    const m = typeof draft.v === 'string' ? /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(draft.v) : null
    draft.v = m ? `${m[1]}.${m[2]}.${m[3] ?? 0}` : '5.12.0'
  },
  breakParentCycle: ({ draft }, paths) => {
    const comps = new Map<string, NodePath>()
    for (const p of paths) comps.set(pathKey(p.slice(0, -1)), p)
    for (const p of comps.values()) {
      const layers = compLayers(draft, p)
      for (const cycle of findParentCycles(layers)) delete layers[cycle[0]].parent
    }
  },
  renumberInd: ({ draft }, paths) => {
    const comps = new Map<string, NodePath>()
    for (const p of paths) comps.set(pathKey(p.slice(0, -1)), p)
    for (const p of comps.values()) renumber(compLayers(draft, p))
  },
  assignInd: ({ draft }, paths) => {
    const comps = new Map<string, NodePath>()
    for (const p of paths) comps.set(pathKey(p.slice(0, -1)), p)
    for (const p of comps.values()) {
      const layers = compLayers(draft, p)
      let max = 0
      for (const l of layers)
        if (typeof l.ind === 'number' && Number.isFinite(l.ind) && l.ind > max) max = l.ind
      for (const l of layers)
        if (typeof l.ind !== 'number' || !Number.isFinite(l.ind)) l.ind = ++max
    }
  },
  removeUnusedAssets: ({ draft }) => removeUnused(draft),
  renameDuplicateAsset: ({ draft }) => {
    const assets = arr(draft.assets).filter(isObj)
    const ids = new Set(assets.map((a) => String(a.id)))
    const seen = new Set<string>()
    for (const a of assets) {
      const id = String(a.id)
      if (!seen.has(id)) {
        seen.add(id)
        continue
      }
      let n = 2
      while (ids.has(`${id}_${n}`)) n++
      a.id = `${id}_${n}`
      ids.add(a.id as string)
    }
  },
  removeChars: ({ draft }) => {
    if (Array.isArray(draft.chars) && draft.chars.length === 0) delete draft.chars
  },
}

/** Fixes that others build on run first (e.g. keyframes are sorted before easing is added). */
const FIX_ORDER: Partial<Record<FixId, number>> = {
  setVersion: 0,
  roundIntegers: 1,
  toBoolean: 1,
  zeroNonFinite: 1,
  upgradeKeyframes: 2,
  sortKeyframes: 3,
  addEasing: 4,
  makeStatic: 5,
  syncAnimatedFlag: 6,
  renameDuplicateAsset: 7,
}

/** True when the issue's fix can be applied (every fix is registered). */
export function canFix(issue: Issue): boolean {
  return !!issue.fix && (issue.fix in PATH_FIXES || issue.fix in GLOBAL_FIXES)
}

/**
 * True when a fix works on whole compositions or the document rather than place by place:
 * limiting it to one occurrence (`applyFixes(…, only)`) may still change the others.
 */
export function isGlobalFix(fix: FixId): boolean {
  return fix in GLOBAL_FIXES
}

/**
 * Applies the fixes of `issues` (optionally restricted to some occurrence paths) to a draft.
 * In-place fixes run first; removals and moves run last and resolve items by identity, so no
 * fix invalidates the paths of another. Returns the number of issues fixed.
 */
export function applyFixes(
  draft: Animation,
  issues: readonly Issue[],
  only?: readonly NodePath[],
): number {
  const ctx: FixContext = { draft: draft as unknown as Json, removals: [], moves: [] }
  const onlyKeys = only ? new Set(only.map(pathKey)) : null
  let fixed = 0
  const ordered = [...issues].sort((a, b) => (FIX_ORDER[a.fix!] ?? 10) - (FIX_ORDER[b.fix!] ?? 10))
  for (const issue of ordered) {
    if (!issue.fix) continue
    const paths = onlyKeys ? issue.paths.filter((p) => onlyKeys.has(pathKey(p))) : issue.paths
    if (onlyKeys && paths.length === 0) continue
    const global = GLOBAL_FIXES[issue.fix]
    if (global) {
      global(ctx, paths)
      fixed++
      continue
    }
    const fix = PATH_FIXES[issue.fix]
    if (!fix) continue
    for (const p of paths) fix(ctx, p)
    fixed++
  }
  for (const { container, item } of ctx.removals) {
    const index = container.indexOf(item)
    if (index >= 0) container.splice(index, 1)
  }
  for (const move of ctx.moves) move()
  return fixed
}
