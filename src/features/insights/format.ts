/**
 * Turns language-neutral issues (`@/lottie/validate`) into what the Issues panel shows: titles
 * and descriptions with formatted parameters, locations ("Precomp › Layer › Group › Fill ›
 * Color"), place counts, affected players and the node an issue points at.
 *
 * Everything here is a pure function of the dictionary and the analyzed document, so it is
 * unit-tested in Node and cheap to call while rendering virtualized rows.
 */
import type { Dict, Language } from '@/i18n'
import { formatBytes } from '@/lib/format'
import {
  isObj,
  levelRank,
  PLAYERS,
  type FeatureId,
  type Json,
  type Level,
  type PlayerId,
} from '@/lottie/compat'
import { layerKind } from '@/lottie/layers'
import { getAt, isLayerPath, isShapePath, layerPathOf, pathKey, type NodePath } from '@/lottie/path'
import { isPropertyLike } from '@/lottie/property'
import type { Animation, Layer } from '@/lottie/types'
import type { Issue, IssueCode, PlatformImpact, Severity } from '@/lottie/validate'

type Params = Readonly<Record<string, string>>
type TextFn = (p: Params) => string

/** Every issue code has a title and a description (checked by the assignment below). */
type IssueTexts = Record<IssueCode, { title: TextFn; about: TextFn }>
type FeatureTexts = Record<FeatureId, { name: string; about: string }>

type Props = Dict['insights']['props']
/** Keys of `t.insights.props` that are plain names (not functions). */
type PropName = { [K in keyof Props]: Props[K] extends string ? K : never }[keyof Props]

export interface FormatOptions {
  t: Dict
  lang: Language
}

/* -------------------------------------------------------------------------- */
/*                                   Numbers                                  */
/* -------------------------------------------------------------------------- */

const numberFormats = new Map<string, Intl.NumberFormat>()

/** Localized number with grouping ("12,345" / "12 345") and at most `digits` decimals. */
export function formatCount(n: number, lang: Language, digits = 2): string {
  const key = `${lang}:${digits}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
      maximumFractionDigits: digits,
    })
    numberFormats.set(key, format)
  }
  return format.format(n)
}

/* -------------------------------------------------------------------------- */
/*                                  Messages                                  */
/* -------------------------------------------------------------------------- */

/** Issue parameters as display strings (sizes, localized numbers, property names). */
export function formatParams(issue: Issue, o: FormatOptions, doc: Animation | null): Params {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(issue.params)) {
    if (typeof value !== 'number') out[key] = value
    else if (key === 'bytes') out[key] = formatBytes(value)
    // Flags compared as strings by the dictionary ("1" / "0").
    else if (key === 'colors') out[key] = String(value)
    else out[key] = formatCount(value, o.lang)
  }
  if (issue.code === 'prop.missing') {
    const path = issue.paths[0]
    out.label =
      (doc && path && propertyName(doc, path, o.t)) || `“${String(issue.params.key ?? '')}”`
  }
  return out
}

function featureTexts(t: Dict): FeatureTexts {
  return t.insights.features
}

function issueTexts(t: Dict): IssueTexts {
  return t.insights.issues
}

/** Name and description of a compatibility feature (compat issues and statistics). */
export function featureText(feature: string, t: Dict): { name: string; about: string } {
  return featureTexts(t)[feature as FeatureId] ?? { name: feature, about: '' }
}

/** One-line title of an issue. */
export function issueTitle(issue: Issue, o: FormatOptions, doc: Animation | null): string {
  if (issue.code === 'compat') return featureText(String(issue.params.feature), o.t).name
  return issueTexts(o.t)[issue.code].title(formatParams(issue, o, doc))
}

/** What the issue means and why it matters (shown when the row is expanded). */
export function issueAbout(issue: Issue, o: FormatOptions, doc: Animation | null): string {
  if (issue.code === 'compat') return featureText(String(issue.params.feature), o.t).about
  return issueTexts(o.t)[issue.code].about(formatParams(issue, o, doc))
}

/* -------------------------------------------------------------------------- */
/*                                  Locations                                 */
/* -------------------------------------------------------------------------- */

/** `table[key]` for keys read from the document ("constructor" must not find Object's). */
function own<T>(table: Readonly<Record<string, T>>, key: unknown): T | undefined {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined
}

const LAYER_TRANSFORM: Record<string, PropName> = {
  a: 'a',
  p: 'p',
  s: 's',
  r: 'r',
  o: 'o',
  sk: 'sk',
  sa: 'sa',
  rx: 'rx',
  ry: 'ry',
  rz: 'rz',
  or: 'or',
}

/** Property names of shape items by item type. */
const SHAPE_PROPS: Record<string, Record<string, PropName>> = {
  rc: { p: 'p', s: 'size', r: 'roundness' },
  el: { p: 'p', s: 'size' },
  sr: {
    p: 'p',
    or: 'outerRadius',
    ir: 'innerRadius',
    os: 'outerRoundness',
    is: 'innerRoundness',
    pt: 'points',
    r: 'r',
  },
  sh: { ks: 'path' },
  fl: { c: 'color', o: 'o' },
  st: { c: 'color', o: 'o', w: 'width', d: 'dashes' },
  gf: { g: 'colors', s: 'startPoint', e: 'endPoint', o: 'o', h: 'highlight', a: 'highlightAngle' },
  gs: {
    g: 'colors',
    s: 'startPoint',
    e: 'endPoint',
    o: 'o',
    w: 'width',
    h: 'highlight',
    a: 'highlightAngle',
    d: 'dashes',
  },
  tm: { s: 'start', e: 'end', o: 'offset' },
  rp: { c: 'copies', o: 'offset', tr: 'transform' },
  rd: { r: 'radius' },
  tr: { a: 'a', p: 'p', s: 's', r: 'r', o: 'o', sk: 'sk', sa: 'sa' },
  op: { a: 'amount', ml: 'miterLimit' },
  pb: { a: 'amount' },
  tw: { a: 'angle', c: 'center' },
  zz: { r: 'ridges', s: 'size' },
}

const REPEATER_TRANSFORM: Record<string, PropName> = {
  ...SHAPE_PROPS.tr,
  so: 'startOpacity',
  eo: 'endOpacity',
}

const MASK_PROPS: Record<string, PropName> = { pt: 'path', o: 'o', x: 'expansion', f: 'feather' }

export interface Location {
  /** Composition name when the node lives in a precomposition. */
  comp: string | null
  /** Node breadcrumb followed by the property (if any). */
  parts: string[]
}

function nameOf(o: unknown): string {
  if (!isObj(o)) return ''
  // Damaged files may store names as numbers; anything else is not a name.
  if (typeof o.nm === 'string') return o.nm.trim()
  return typeof o.nm === 'number' ? String(o.nm) : ''
}

/**
 * Display name of a layer or shape item, like `nodeDisplayName`, but tolerant of whatever a
 * damaged file stores in `nm` and `ty` (the Issues panel exists to show such files).
 */
function nodeName(doc: Animation, path: NodePath, t: Dict): string {
  const node = getAt(doc, path)
  const name = nameOf(node)
  if (name) return name
  const index = path[path.length - 1]
  if (isLayerPath(path)) {
    const ty = isObj(node) ? node.ty : undefined
    // Unknown types classify as 'other' (the cast only widens the enum for the lookup).
    const kind = layerKind({ ty: (typeof ty === 'number' ? ty : -1) as Layer['ty'] })
    return `${t.common.layerKinds[kind]} ${typeof index === 'number' ? index + 1 : ''}`.trim()
  }
  const ty = isObj(node) && typeof node.ty === 'string' ? node.ty : ''
  if (ty === 'sr' && isObj(node) && node.sy === 2) return t.common.polygon
  const types = t.common.shapeTypes as Record<string, string>
  return own(types, ty) ?? t.common.shapeTypes.unknown
}

/** "Layer › Group › Fill" for a layer or shape item path. */
function breadcrumb(doc: Animation, nodePath: NodePath, layerPath: NodePath, t: Dict): string[] {
  const parts = [nodeName(doc, layerPath, t)]
  for (let i = layerPath.length + 2; i <= nodePath.length; i += 2)
    parts.push(nodeName(doc, nodePath.slice(0, i), t))
  return parts
}

function assetLabel(asset: unknown, t: Dict): string {
  const a = isObj(asset) ? asset : {}
  const id = a.id === undefined ? '' : String(a.id)
  if (Array.isArray(a.layers)) return t.insights.props.precomp(nameOf(a) || id)
  if (typeof a.p === 'string') return t.insights.props.image(id)
  return t.insights.props.asset(id)
}

/** Path of the deepest shape item in `path` (or its layer). */
function nodePathIn(path: NodePath, layerPath: NodePath): NodePath {
  let node = layerPath
  for (let i = layerPath.length + 2; i <= path.length; i += 2) {
    const sub = path.slice(0, i)
    if (!isShapePath(sub)) break
    node = sub
  }
  return node
}

/** Keyframe index when `path` continues into the keyframes of the property at `propPath`. */
function keyframeIndexAt(doc: Animation, propPath: NodePath, path: NodePath): number | null {
  if (path.length < propPath.length + 2 || path[propPath.length] !== 'k') return null
  const index = path[propPath.length + 1]
  if (typeof index !== 'number') return null
  const kf = getAt(doc, [...propPath, 'k', index])
  return isObj(kf) && 't' in kf ? index : null
}

/** Longest prefix of `path` (below `from`) that is an animatable property. */
function propertyPathIn(doc: Animation, path: NodePath, from: number): NodePath | null {
  for (let i = path.length; i > from; i--) {
    const sub = path.slice(0, i)
    if (isPropertyLike(getAt(doc, sub))) return sub
  }
  return null
}

/** Names for the part of a path below a layer or shape item. */
function describeRest(doc: Animation, nodePath: NodePath, rest: NodePath, t: Dict): string[] {
  const props = t.insights.props
  const node = getAt(doc, nodePath)
  const out: string[] = []
  const [k0, k1, k2, k3] = rest
  if (k0 === undefined) return out
  if (isLayerPath(nodePath)) {
    if (k0 === 'ks') {
      if (k1 === 'p' && (k2 === 'x' || k2 === 'y')) out.push(props[k2])
      else out.push(props[own(LAYER_TRANSFORM, k1) ?? 'transform'])
    } else if (k0 === 'tm') {
      out.push(props.tm)
    } else if (k0 === 'masksProperties' && typeof k1 === 'number') {
      const mask = getAt(doc, [...nodePath, k0, k1])
      out.push(nameOf(mask) || props.mask(k1 + 1))
      const name = own(MASK_PROPS, k2)
      if (name) out.push(props[name])
    } else if (k0 === 'ef' && typeof k1 === 'number') {
      const effect = getAt(doc, [...nodePath, k0, k1])
      out.push(nameOf(effect) || props.effect(k1 + 1))
      if (k2 === 'ef' && typeof k3 === 'number')
        out.push(nameOf(getAt(doc, [...nodePath, k0, k1, k2, k3])) || props.value)
    } else if (k0 === 'sy' && typeof k1 === 'number') {
      out.push(nameOf(getAt(doc, [...nodePath, k0, k1])) || props.style(k1 + 1))
    } else if (k0 === 't') {
      if (k1 === 'd') out.push(props.sourceText)
      else if (k1 === 'a' && typeof k2 === 'number')
        out.push(nameOf(getAt(doc, [...nodePath, 't', 'a', k2])) || props.animator(k2 + 1))
      else if (k1 === 'p') out.push(props.textPath)
    }
  } else if (isObj(node) && typeof node.ty === 'string' && typeof k0 === 'string') {
    const table = own(SHAPE_PROPS, node.ty)
    const name = table && own(table, k0)
    if (name) out.push(props[name])
    const repeater = node.ty === 'rp' && k0 === 'tr' ? own(REPEATER_TRANSFORM, k1) : undefined
    if (repeater) out.push(props[repeater])
  }
  const propPath = propertyPathIn(doc, [...nodePath, ...rest], nodePath.length)
  const kf = propPath ? keyframeIndexAt(doc, propPath, [...nodePath, ...rest]) : null
  if (kf !== null) out.push(props.keyframe(kf + 1))
  return out
}

/** Where a path points: composition, node breadcrumb and property. */
export function locate(doc: Animation, path: NodePath, t: Dict): Location {
  const layerPath = layerPathOf(path)
  if (!layerPath) {
    const root = path[0]
    const props = t.insights.props
    if (root === 'assets' && typeof path[1] === 'number') {
      return { comp: null, parts: [assetLabel(getAt(doc, ['assets', path[1]]), t)] }
    }
    if (root === 'chars') return { comp: null, parts: [props.glyphs] }
    if (root === 'fonts') return { comp: null, parts: [props.fonts] }
    if (root === 'slots') return { comp: null, parts: [props.slots] }
    return { comp: null, parts: [t.insights.panel.document] }
  }
  let comp: string | null = null
  if (layerPath[0] === 'assets' && typeof layerPath[1] === 'number') {
    const asset = getAt(doc, ['assets', layerPath[1]])
    comp = nameOf(asset) || String((isObj(asset) && asset.id) ?? '')
  }
  const nodePath = nodePathIn(path, layerPath)
  const parts = getAt(doc, nodePath) === undefined ? [] : breadcrumb(doc, nodePath, layerPath, t)
  parts.push(...describeRest(doc, nodePath, path.slice(nodePath.length), t))
  return { comp, parts }
}

/** "Comp › Layer › Group › Fill › Color". */
export function locationText(loc: Location): string {
  return (loc.comp ? [loc.comp, ...loc.parts] : loc.parts).join(' › ')
}

/** Display name of the property at the end of a path ("Color"), or '' when unknown. */
export function propertyName(doc: Animation, path: NodePath, t: Dict): string {
  const layerPath = layerPathOf(path)
  if (!layerPath) return ''
  const nodePath = nodePathIn(path, layerPath)
  const rest = describeRest(doc, nodePath, path.slice(nodePath.length), t)
  return rest[rest.length - 1] ?? ''
}

/** Short summary of where an issue occurs ("Layer 3 › Fill", "in 8 layers", "12 places in 5 layers"). */
export function placesSummary(issue: Issue, doc: Animation | null, t: Dict): string {
  const { paths, count } = issue
  const panel = t.insights.panel
  if (!doc || paths.length === 0) return panel.document
  if (issue.code === 'layer.parentCycle') {
    // The loop in walking order, closed: "A → B → A".
    const names = paths.map((p) => locate(doc, p, t).parts[0] ?? '')
    return [...names, names[0]].join(' → ')
  }
  if (count <= 1 || paths.length === 1) return locationText(locate(doc, paths[0], t))
  const allLayers = paths.every(isLayerPath)
  if (count === 2 && paths.length === 2 && allLayers)
    return paths.map((p) => locate(doc, p, t).parts[0]).join(', ')
  if (paths.every((p) => p[0] === 'assets' && p.length === 2)) return panel.assets(count)
  if (allLayers) return panel.inLayers(count)
  const layers = new Set<string>()
  for (const p of paths) {
    const layer = layerPathOf(p)
    if (layer) layers.add(pathKey(layer))
  }
  // One place per layer reads better as "in 300 layers" than "300 places in 300 layers".
  if (layers.size === count && paths.length === count) return panel.inLayers(count)
  return layers.size ? panel.placesInLayers(count, layers.size) : panel.places(count)
}

/* -------------------------------------------------------------------------- */
/*                                   Players                                  */
/* -------------------------------------------------------------------------- */

const PLAYER_ORDER = new Map<PlayerId, number>(PLAYERS.map((p, i) => [p, i]))
const WEB: readonly PlayerId[] = ['web-svg', 'web-canvas', 'web-html']

/** Affected players in display order. */
export function sortedPlatforms(
  platforms: readonly PlatformImpact[] | undefined,
): PlatformImpact[] {
  return [...(platforms ?? [])].sort(
    (a, b) => (PLAYER_ORDER.get(a.player) ?? 0) - (PLAYER_ORDER.get(b.player) ?? 0),
  )
}

export interface PlayerChip {
  key: string
  label: string
  /** Full player names for the tooltip. */
  full: string
  level: Level
}

/** Chips for a row: lottie-web renderers are merged into one "Web" chip when several are affected. */
export function playerChips(
  platforms: readonly PlatformImpact[] | undefined,
  t: Dict,
): PlayerChip[] {
  const list = sortedPlatforms(platforms)
  const web = list.filter((p) => WEB.includes(p.player))
  const chips: PlayerChip[] = []
  let webDone = false
  for (const p of list) {
    if (WEB.includes(p.player) && web.length > 1) {
      if (webDone) continue
      webDone = true
      const worst = web.reduce<Level>(
        (w, x) => (levelRank(x.level) > levelRank(w) ? x.level : w),
        'y',
      )
      chips.push({
        key: 'web',
        label: t.insights.targets.web,
        full: web.map((x) => t.insights.players[x.player].full).join(', '),
        level: worst,
      })
      continue
    }
    const names = t.insights.players[p.player]
    chips.push({ key: p.player, label: names.short, full: names.full, level: p.level })
  }
  return chips
}

/** One-word verdict for a player ("Breaks"); Telegram rejects stickers instead of breaking. */
export function verdictText(player: PlayerId, level: Level, t: Dict): string {
  if (player === 'telegram' && level === 'x') return t.insights.verdictRejected
  return t.insights.verdicts[level]
}

/** What a level means for a player ("Breaks: …"); Telegram rejects instead of breaking. */
export function levelText(player: PlayerId, level: Level, t: Dict): string {
  if (player === 'telegram' && level === 'x') return t.insights.telegramRejected
  return t.insights.levels[level]
}

/* -------------------------------------------------------------------------- */
/*                                  Targets                                   */
/* -------------------------------------------------------------------------- */

export interface ShowTarget {
  /** Layer or shape item to select. */
  node: NodePath | null
  /** Property to focus (inspector / timeline). */
  property: NodePath | null
  /** Keyframe to select when the path points into one. */
  keyframe: { path: NodePath; index: number } | null
  /** Asset index when the path points at an asset. */
  asset: number | null
}

/** The node, property and keyframe a path points at in `doc`. */
export function showTarget(doc: Animation, path: NodePath): ShowTarget {
  const layerPath = layerPathOf(path)
  if (!layerPath) {
    const asset = path[0] === 'assets' && typeof path[1] === 'number' ? path[1] : null
    return { node: null, property: null, keyframe: null, asset }
  }
  const node = nodePathIn(path, layerPath)
  if (!isObj(getAt<Json>(doc, node)))
    return { node: null, property: null, keyframe: null, asset: null }
  const property = propertyPathIn(doc, path, node.length)
  const index = property ? keyframeIndexAt(doc, property, path) : null
  return {
    node,
    property,
    keyframe: property && index !== null ? { path: property, index } : null,
    asset: null,
  }
}

/** True when "Show" can select something for the issue. */
export function canShow(issue: Issue): boolean {
  return issue.paths.some(
    (p) => layerPathOf(p) !== null || (p[0] === 'assets' && typeof p[1] === 'number'),
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Actions                                  */
/* -------------------------------------------------------------------------- */

/** Tools that resolve issues without an automatic fix. */
export type ToolAction = 'resize' | 'timing' | 'optimize' | 'locate' | 'fonts'

const TOOL_ACTIONS: Partial<Record<IssueCode, ToolAction>> = {
  'doc.size': 'resize',
  'telegram.size': 'resize',
  'perf.canvas': 'resize',
  'doc.frameRate': 'timing',
  'doc.range': 'timing',
  'telegram.fps': 'timing',
  'telegram.duration': 'timing',
  'perf.frames': 'timing',
  'perf.fileSize': 'optimize',
  'telegram.fileSize': 'optimize',
  'perf.keyframes': 'optimize',
  'perf.layers': 'optimize',
  'image.huge': 'optimize',
  'image.oversized': 'optimize',
  'layer.neverVisible': 'optimize',
  'shape.emptyLayer': 'optimize',
  'text.unknownFont': 'fonts',
  'text.noFonts': 'fonts',
}

/** The tool that helps with an issue (when it has no automatic fix of its own). */
export function toolAction(issue: Issue): ToolAction | null {
  if (issue.code === 'image.external') return issue.params.kind === 'file' ? 'locate' : null
  return TOOL_ACTIONS[issue.code] ?? null
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                    */
/* -------------------------------------------------------------------------- */

/** Severity groups in display order. */
export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info']

/** Plain-text description of an issue (for bug reports and chats). */
export function describeIssue(
  issue: Issue,
  o: FormatOptions,
  doc: Animation | null,
  maxPlaces = 20,
): string {
  const { t } = o
  const lines = [
    `${t.insights.severity[issue.severity]}: ${issueTitle(issue, o, doc)}`,
    issueAbout(issue, o, doc),
  ]
  const platforms = sortedPlatforms(issue.platforms)
  if (platforms.length) {
    lines.push('', `${t.insights.panel.players}:`)
    for (const p of platforms)
      lines.push(`- ${t.insights.players[p.player].full}: ${levelText(p.player, p.level, t)}`)
  }
  if (doc && issue.paths.length && issue.paths[0].length) {
    lines.push('', `${t.insights.panel.places(issue.count)}:`)
    for (const p of issue.paths.slice(0, maxPlaces))
      lines.push(`- ${locationText(locate(doc, p, t))}`)
    if (issue.count > maxPlaces)
      lines.push(`- ${t.insights.panel.notListed(issue.count - maxPlaces)}`)
  }
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n')
}
