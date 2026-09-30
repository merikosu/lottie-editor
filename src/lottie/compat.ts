/**
 * Player compatibility: which Lottie features each player renders, and where a document uses
 * them.
 *
 * The support matrix is based on a source-code review of the players (research snapshot
 * 2026-09-29): lottie-web 5.13.0, lottie-ios main (release 4.6.1), lottie-android main
 * (release 6.7.1), ThorVG main (dotLottie players, dotlottie-web 0.80), Skottie (Skia main),
 * plus Telegram's published requirements for animated stickers. Notes are kept in English for
 * maintainers; the UI shows translated descriptions per feature instead.
 *
 * Levels:
 *   'y' supported, roughly as in After Effects
 *   'p' partial, approximate or conditional
 *   'n' ignored: the rest of the animation plays, this feature is missing
 *   'x' breaks: fails to load, throws or renders obviously wrong content
 *       (for Telegram: the sticker is rejected)
 *   '?' not verified
 *
 * The module also contains the shared document scan (compositions, layers, shape items and
 * animatable properties with their JSON paths) used by validation, statistics and the
 * optimizer, and the graph checks that are easy to get wrong (matte sources, parent loops,
 * precomposition recursion).
 */
import { isPropertyLike } from './property'
import type { NodePath } from './path'
import type { Animation } from './types'

/* -------------------------------------------------------------------------- */
/*                                   Players                                  */
/* -------------------------------------------------------------------------- */

export const PLAYERS = [
  'web-svg',
  'web-canvas',
  'web-html',
  'ios',
  'android',
  'thorvg',
  'skottie',
  'telegram',
] as const
export type PlayerId = (typeof PLAYERS)[number]

export type Level = 'y' | 'p' | 'n' | 'x' | '?'
/** A bare level, or [level, note]. */
export type Cell = Level | readonly [Level, string]

export type FeatureGroup =
  | 'layer'
  | 'text'
  | 'time'
  | 'transform'
  | 'blend'
  | 'matte'
  | 'mask'
  | 'paint'
  | 'modifier'
  | 'effect'
  | 'style'
  | 'other'

export interface FeatureDef {
  readonly group: FeatureGroup
  /** Human-readable detection rule (the executable version is `detectFeatures`). */
  readonly detect: string
  /** Part of the Lottie 1.0 specification (lottie/lottie-spec). */
  readonly spec: boolean
  readonly s: Readonly<Record<PlayerId, Cell>>
  /** Minimum player version where support starts (only where it matters). */
  readonly since?: Readonly<Partial<Record<PlayerId, string>>>
}

const ALL_SUPPORTED: Readonly<Record<PlayerId, Cell>> = {
  'web-svg': 'y',
  'web-canvas': 'y',
  'web-html': 'y',
  ios: 'y',
  android: 'y',
  thorvg: 'y',
  skottie: 'y',
  telegram: 'y',
}

/** Support cells: everything supported except the given players. */
function cells(overrides: Partial<Record<PlayerId, Cell>> = {}): Readonly<Record<PlayerId, Cell>> {
  return { ...ALL_SUPPORTED, ...overrides }
}

/** Every lottie-web renderer. */
function web(cell: Cell): Partial<Record<PlayerId, Cell>> {
  return { 'web-svg': cell, 'web-canvas': cell, 'web-html': cell }
}

const TG_REJECTED = ['x', 'Not allowed in Telegram animated stickers'] as const

export const FEATURES = {
  /* --------------------------------- layers -------------------------------- */
  'layer.precomp': {
    group: 'layer',
    detect: 'layer.ty === 0',
    spec: true,
    // Missing w/h is reported by validation (precomp.missingSize).
    s: cells(),
  },
  'layer.solid': {
    group: 'layer',
    detect: 'layer.ty === 1',
    spec: true,
    s: cells({ telegram: TG_REJECTED }),
  },
  'layer.image': {
    group: 'layer',
    detect: 'layer.ty === 2',
    spec: true,
    s: cells({
      'web-canvas': ['y', 'Canvas waits for every image to load before the first frame'],
      android: ['y', 'Bitmap is resized to asset w/h'],
      telegram: TG_REJECTED,
    }),
  },
  'layer.null': { group: 'layer', detect: 'layer.ty === 3', spec: true, s: cells() },
  'layer.shape': { group: 'layer', detect: 'layer.ty === 4', spec: true, s: cells() },
  'layer.text': {
    group: 'layer',
    detect: 'layer.ty === 5 (details: text.glyphs / text.fonts)',
    spec: false,
    s: cells({ telegram: TG_REJECTED }),
  },
  'layer.audio': {
    group: 'layer',
    detect: 'layer.ty === 6',
    spec: false,
    s: cells({
      ...web(['p', 'Only with loadAnimation({ audioFactory }) or window.Howl; silent otherwise']),
      ios: 'n',
      android: 'n',
      thorvg: ['p', 'dotlottie-web builds include audio; native ThorVG needs an audio resolver'],
      skottie: ['p', 'Embedder must supply ResourceProvider::loadAudioAsset'],
      telegram: 'n',
    }),
  },
  'layer.camera': {
    group: 'layer',
    detect: 'layer.ty === 13',
    spec: false,
    s: cells({
      'web-svg': [
        'x',
        'Throws "You\'re using a 3d camera. Try the html renderer." and nothing renders',
      ],
      'web-canvas': ['x', 'Same throw as SVG'],
      ios: ['n', 'Decoded as a null layer'],
      android: ['n', 'Unknown layer type, dropped (children lose this parent)'],
      thorvg: ['n', 'Treated like a null layer; no perspective'],
      telegram: TG_REJECTED,
    }),
  },
  'layer.data': {
    group: 'layer',
    detect: 'layer.ty === 15',
    spec: false,
    s: cells({
      ios: ['p', 'Ignored; only meaningful for expressions'],
      android: ['p', 'Ignored; only meaningful for expressions'],
      thorvg: ['p', 'Ignored; only meaningful for expressions'],
      skottie: ['p', 'Ignored; only meaningful for expressions'],
    }),
  },
  'layer.unsupportedType': {
    group: 'layer',
    detect: 'layer.ty not in {0,1,2,3,4,5,6,13,15} (video 9, guide 11, adjustment 12, light 14, …)',
    spec: false,
    s: cells({
      ...web(['n', 'Built as a null layer']),
      ios: 'n',
      android: 'n',
      thorvg: 'n',
      skottie: ['p', 'ty 9 (video) handled as footage; others ignored'],
      telegram: 'n',
    }),
  },
  'layer.hidden': {
    group: 'layer',
    detect: 'layer.hd === true',
    spec: true,
    // Hidden matte sources are reported by validation (matte.hiddenSource).
    s: cells(),
  },
  'layer.motionBlur': {
    group: 'layer',
    detect: 'layer.mb === true',
    spec: false,
    s: cells({ ...web('n'), ios: 'n', android: 'n', thorvg: 'n', skottie: 'n', telegram: 'n' }),
  },

  /* ---------------------------------- text --------------------------------- */
  'text.glyphs': {
    group: 'text',
    detect: 'text layer whose font has chars[] with the same fFamily and style',
    spec: false,
    s: cells({
      ios: ['n', 'Glyphs ignored; Core Text renders the font (system fallback when missing)'],
      thorvg: ['p', 'Glyph paths only when the font origin is 0 (local)'],
    }),
  },
  'text.fonts': {
    group: 'text',
    detect: 'text layer whose font has no matching chars[]',
    spec: false,
    s: cells({
      'web-svg': ['p', 'Browser font by fFamily; fonts.list fPath is loaded (waits up to 5 s)'],
      'web-canvas': ['x', 'CVTextElement only draws glyph paths: text is invisible'],
      'web-html': ['p', 'Same as SVG'],
      ios: ['p', 'Needs the font installed or bundled; silent system-font fallback otherwise'],
      android: [
        'x',
        'Needs assets/fonts/<fFamily>.ttf (or a font delegate); RuntimeException otherwise',
      ],
      thorvg: ['p', 'Needs an embedded (data:) or host-loaded font'],
      skottie: ['p', 'Embedder font manager; falls back to the default typeface'],
    }),
  },
  'text.animators': {
    group: 'text',
    detect: 'layer.t.a.length > 0',
    spec: false,
    s: cells({
      ios: ['p', 'Main-thread engine only; subset of properties'],
      android: ['p', 'Only the first range selector'],
    }),
    since: { android: '6.5.0', ios: '4.5.0' },
  },
  'text.path': {
    group: 'text',
    detect: "typeof layer.t.p.m === 'number'",
    spec: false,
    s: cells({ ios: 'n', android: 'n' }),
  },

  /* ---------------------------------- time --------------------------------- */
  'time.remap': {
    group: 'time',
    detect: 'layer.tm is an object',
    spec: true,
    s: cells({
      ios: ['y', 'Complex remapping forces the slower main-thread engine'],
      telegram: TG_REJECTED,
    }),
  },
  'time.stretch': {
    group: 'time',
    detect: 'layer.sr is a number other than 1',
    spec: true,
    s: cells({ telegram: TG_REJECTED }),
  },

  /* ------------------------------- transform ------------------------------- */
  'transform.3d': {
    group: 'transform',
    detect: 'layer.ddd === 1 or ks.rx / ks.ry / ks.or present',
    spec: false,
    s: cells({
      'web-svg': ['p', 'Flattened (orthographic)'],
      'web-canvas': ['p', 'Flattened (orthographic)'],
      ios: ['p', 'Core Animation: rx/ry rotations, no perspective or camera'],
      android: ['p', 'rx/ry/rz orthographic since 6.7.0; no camera or perspective'],
      thorvg: ['p', 'Rotations folded into a 2D transform'],
      telegram: TG_REJECTED,
    }),
    since: { android: '6.7.0', ios: '4.1.3' },
  },
  'transform.autoOrient': {
    group: 'transform',
    detect: 'layer.ao === 1',
    spec: true,
    s: cells({ ios: ['n', 'No auto-orient handling in lottie-ios'], telegram: TG_REJECTED }),
  },
  'transform.layerSkew': {
    group: 'transform',
    detect: 'layer.ks.sk non-zero (static or animated)',
    spec: true,
    s: cells({ ios: ['n', 'Layer transforms have no skew (only shape group transforms do)'] }),
  },

  /* ---------------------------------- blend -------------------------------- */
  'blend.basic': {
    group: 'blend',
    detect: 'layer.bm in 1..5',
    spec: true,
    s: cells({ android: ['y', 'Multiply approximated below API 29'] }),
    since: { android: '6.5.0' },
  },
  'blend.advanced': {
    group: 'blend',
    detect: 'layer.bm in 6..15',
    spec: true,
    s: cells({ android: ['n', 'Rendered as normal'] }),
  },
  'blend.add': {
    group: 'blend',
    detect: 'layer.bm === 16',
    spec: true,
    s: cells({
      ...web(['n', 'Not in the blend map: normal']),
      ios: ['n', 'Not in BlendMode: normal'],
    }),
  },
  'blend.hardMix': {
    group: 'blend',
    detect: 'layer.bm === 17',
    spec: false,
    s: cells({ ...web('n'), ios: 'n', android: 'n', thorvg: 'n' }),
  },
  'blend.shape': {
    group: 'blend',
    detect: 'shape item with bm other than 0',
    spec: false,
    s: cells({ 'web-canvas': 'n', ios: 'n', android: 'n', skottie: 'n' }),
  },

  /* ---------------------------------- mattes ------------------------------- */
  'matte.alpha': {
    group: 'matte',
    detect: 'layer.tt === 1',
    spec: true,
    // Source resolution problems are reported by validation (matte.*).
    s: cells({
      'web-html': ['x', 'Mattes are not implemented: target unmasked and source visible'],
    }),
  },
  'matte.alphaInverted': {
    group: 'matte',
    detect: 'layer.tt === 2',
    spec: true,
    s: cells({ 'web-html': ['x', 'Mattes are not implemented'] }),
  },
  'matte.luma': {
    group: 'matte',
    detect: 'layer.tt === 3',
    spec: true,
    s: cells({
      'web-html': ['x', 'Mattes are not implemented'],
      ios: ['x', 'Decoded as unknown: target drawn unmasked'],
      android: ['x', '"Unsupported matte type: Luma": target unmasked and source drawn'],
    }),
    since: { 'web-canvas': '5.10.2' },
  },
  'matte.lumaInverted': {
    group: 'matte',
    detect: 'layer.tt === 4',
    spec: true,
    s: cells({
      'web-svg': ['x', 'No mask branch for tt 4: mask="url(#…_4)" points to a missing <mask>'],
      'web-html': ['x', 'Mattes are not implemented'],
      ios: ['x', 'tt 4 is not decodable'],
      android: ['x', 'Target unmasked and source drawn'],
    }),
    since: { 'web-canvas': '5.10.2' },
  },
  'matte.parent': {
    group: 'matte',
    detect: "typeof layer.tp === 'number'",
    spec: true,
    // Adjacency-only players are handled by validation (matte.notAdjacent).
    s: cells({ 'web-html': ['x', 'Mattes are not implemented'] }),
    since: { 'web-svg': '5.10.0', 'web-canvas': '5.10.0' },
  },
  'matte.nested': {
    group: 'matte',
    detect: 'a matte source (td) that itself has a track matte (tt)',
    spec: false,
    s: cells({
      'web-svg': ['n', 'Inner matte ignored'],
      'web-canvas': '?',
      'web-html': 'x',
      ios: ['x', 'Consecutive matted layers pair two at a time'],
      android: ['x', 'The inner matte source becomes a visible layer'],
      thorvg: '?',
      skottie: ['n', 'The matte uses the content without its own matte'],
    }),
  },

  /* ---------------------------------- masks -------------------------------- */
  'mask.any': {
    group: 'mask',
    detect: 'masksProperties is not empty',
    spec: true,
    s: cells({ telegram: TG_REJECTED }),
  },
  'mask.add': {
    group: 'mask',
    detect: "mask.mode === 'a'",
    spec: true,
    s: cells({ 'web-canvas': ['y', 'All masks are unioned into one clip'] }),
  },
  'mask.subtract': {
    group: 'mask',
    detect: "mask.mode === 's'",
    spec: true,
    s: cells({ 'web-canvas': ['x', 'Mode ignored: clips to the path, the inverse of the intent'] }),
  },
  'mask.intersect': {
    group: 'mask',
    detect: "mask.mode === 'i'",
    spec: true,
    s: cells({ 'web-canvas': ['p', 'Treated as union (only correct for a single mask)'] }),
  },
  'mask.lightenDarken': {
    group: 'mask',
    detect: "mask.mode === 'l' || mask.mode === 'd'",
    spec: false,
    s: cells({
      ...web(['p', 'Rendered as add']),
      ios: ['p', 'Lighten as add, darken as intersect'],
      android: ['p', 'Rendered as add'],
      skottie: ['n', 'Mask skipped ("Unsupported mask mode")'],
    }),
  },
  'mask.difference': {
    group: 'mask',
    detect: "mask.mode === 'f'",
    spec: false,
    s: cells({
      ...web(['p', 'Rendered as add']),
      ios: ['p', 'Rendered as intersect'],
      android: ['p', 'Rendered as add'],
    }),
  },
  'mask.inverted': {
    group: 'mask',
    detect: 'mask.inv === true',
    spec: false,
    // Key order problems are reported by validation (mask.keyOrder).
    s: cells({ 'web-canvas': ['p', 'Depends on the path winding'] }),
  },
  'mask.opacity': {
    group: 'mask',
    detect: 'mask.o animated or not 100',
    spec: true,
    s: cells({ 'web-canvas': ['n', 'Ignored'] }),
  },
  'mask.expansion': {
    group: 'mask',
    detect: 'mask.x animated or not 0',
    spec: false,
    s: cells({ 'web-canvas': 'n', ios: ['n', 'Parsed, not applied'], android: 'n', skottie: 'n' }),
  },
  'mask.feather': {
    group: 'mask',
    detect: 'mask.f present and not 0',
    spec: false,
    s: cells({ ...web('n'), ios: 'n', android: 'n', thorvg: 'n', telegram: 'n' }),
  },

  /* ------------------------------ paint / shapes --------------------------- */
  'paint.polystar': {
    group: 'paint',
    detect: "shape.ty === 'sr'",
    spec: true,
    s: cells({
      ios: ['y', 'Rounded polygons fall back to the main-thread engine'],
      telegram: TG_REJECTED,
    }),
  },
  'paint.gradient': {
    group: 'paint',
    detect: "shape.ty === 'gf' || shape.ty === 'gs'",
    spec: true,
    s: cells(),
  },
  'paint.gradientStroke': {
    group: 'paint',
    detect: "shape.ty === 'gs'",
    spec: true,
    s: cells({ telegram: TG_REJECTED }),
  },
  'paint.gradientOpacity': {
    group: 'paint',
    detect: 'gradient data longer than p * 4 (opacity stops)',
    spec: true,
    s: cells({ 'web-canvas': ['p', 'Opacity applied only when opacity stops match color stops'] }),
  },
  'paint.strokeDash': {
    group: 'paint',
    detect: 'stroke d is a non-empty array',
    spec: true,
    s: cells({ ios: ['y', 'Animated dashes fall back to the main-thread engine'] }),
  },
  'paint.fillRuleEvenOdd': { group: 'paint', detect: 'fill r === 2', spec: true, s: cells() },
  'paint.hiddenShape': { group: 'paint', detect: 'shape.hd === true', spec: true, s: cells() },

  /* -------------------------------- modifiers ------------------------------ */
  'mod.trim': {
    group: 'modifier',
    detect: "shape.ty === 'tm' && shape.m !== 2",
    spec: true,
    s: cells({ ios: ['y', 'Trims on filled shapes fall back to the main-thread engine'] }),
  },
  'mod.trimIndividually': {
    group: 'modifier',
    detect: "shape.ty === 'tm' && shape.m === 2",
    spec: true,
    s: cells({ ios: ['p', 'Core Animation trims each path separately regardless of m'] }),
  },
  'mod.repeater': {
    group: 'modifier',
    detect: "shape.ty === 'rp'",
    spec: false,
    s: cells({
      ios: ['p', 'Core Animation only; animated copies fall back'],
      telegram: TG_REJECTED,
    }),
  },
  'mod.roundCorners': {
    group: 'modifier',
    detect: "shape.ty === 'rd'",
    spec: true,
    s: cells({ ios: ['p', 'Not on combined shapes or polygons in Core Animation'] }),
    since: { android: '5.0.1' },
  },
  'mod.mergePaths': {
    group: 'modifier',
    detect: "shape.ty === 'mm'",
    spec: false,
    s: cells({
      ...web(['n', 'Silently ignored']),
      ios: ['n', 'Parsed, never rendered'],
      android: ['p', 'Opt-in feature flag (MergePathsApi19); ignored otherwise'],
      thorvg: ['n', '"MergePath(mm) is not supported yet"'],
      telegram: TG_REJECTED,
    }),
  },
  'mod.offsetPath': {
    group: 'modifier',
    detect: "shape.ty === 'op'",
    spec: false,
    s: cells({ ios: 'n', android: 'n' }),
    since: { 'web-svg': '5.10.0', 'web-canvas': '5.10.0', 'web-html': '5.10.0' },
  },
  'mod.zigZag': {
    group: 'modifier',
    detect: "shape.ty === 'zz'",
    spec: false,
    s: cells({ ios: 'n', android: 'n', skottie: 'n' }),
    since: { 'web-svg': '5.10.0', 'web-canvas': '5.10.0', 'web-html': '5.10.0' },
  },
  'mod.puckerBloat': {
    group: 'modifier',
    detect: "shape.ty === 'pb'",
    spec: true,
    s: cells({ ios: 'n', android: 'n' }),
  },
  'mod.twist': {
    group: 'modifier',
    detect: "shape.ty === 'tw'",
    spec: false,
    s: cells({ ...web('n'), ios: 'n', android: 'n', thorvg: 'n', skottie: 'n' }),
  },

  /* --------------------------------- effects ------------------------------- */
  'fx.any': {
    group: 'effect',
    detect: 'layer.ef is not empty',
    spec: false,
    s: cells({ telegram: TG_REJECTED }),
  },
  'fx.expressionControls': {
    group: 'effect',
    detect: 'ef[].ty === 5 (sliders, colors, points…)',
    spec: false,
    // No visual output by themselves; players that ignore them lose nothing.
    s: cells(),
  },
  'fx.tint': {
    group: 'effect',
    detect: 'ef[].ty === 20',
    spec: false,
    s: cells({ 'web-canvas': 'n', 'web-html': 'n', ios: 'n', android: 'n' }),
  },
  'fx.fill': {
    group: 'effect',
    detect: 'ef[].ty === 21',
    spec: false,
    s: cells({ 'web-canvas': 'n', 'web-html': 'n', ios: 'n', android: 'n' }),
  },
  'fx.stroke': {
    group: 'effect',
    detect: 'ef[].ty === 22',
    spec: false,
    s: cells({
      'web-svg': ['p', 'Some controls are ignored'],
      'web-canvas': 'n',
      'web-html': 'n',
      ios: 'n',
      android: 'n',
      thorvg: ['p', 'Only strokes layer masks'],
      skottie: 'n',
    }),
  },
  'fx.tritone': {
    group: 'effect',
    detect: 'ef[].ty === 23',
    spec: false,
    s: cells({ 'web-canvas': 'n', 'web-html': 'n', ios: 'n', android: 'n' }),
  },
  'fx.levels': {
    group: 'effect',
    detect: 'ef[].ty === 24',
    spec: false,
    s: cells({ 'web-canvas': 'n', 'web-html': 'n', ios: 'n', android: 'n', thorvg: 'n' }),
  },
  'fx.dropShadow': {
    group: 'effect',
    detect: 'ef[].ty === 25',
    spec: false,
    s: cells({
      'web-canvas': 'n',
      'web-html': 'n',
      android: ['p', 'Applied per fill and stroke, clipped to precomp bounds'],
    }),
    since: { ios: '4.3.0', android: '4.1.0' },
  },
  'fx.gaussianBlur': {
    group: 'effect',
    detect: 'ef[].ty === 29',
    spec: false,
    s: cells({
      'web-canvas': 'n',
      'web-html': 'n',
      ios: 'n',
      android: ['p', 'Per fill and stroke'],
    }),
    since: { android: '4.1.0' },
  },
  'fx.transform': {
    group: 'effect',
    detect: 'ef[].ty === 35',
    spec: false,
    s: cells({ 'web-html': ['p', 'Full build only'], ios: 'n', android: 'n', thorvg: 'n' }),
    since: { 'web-svg': '5.12.0', 'web-canvas': '5.12.0' },
  },
  'fx.setMatte': {
    group: 'effect',
    detect: 'ef[].ty === 28',
    spec: false,
    s: cells({
      'web-canvas': 'n',
      'web-html': 'n',
      ios: 'n',
      android: 'n',
      thorvg: 'n',
      skottie: 'n',
    }),
  },
  'fx.skottieOnly': {
    group: 'effect',
    detect: 'ef[].ty in {26, 27} or a match name only Skottie understands',
    spec: false,
    s: cells({ ...web('n'), ios: 'n', android: 'n', thorvg: 'n' }),
  },
  'fx.unknown': {
    group: 'effect',
    detect: 'any other ef[].ty',
    spec: false,
    s: cells({ ...web('n'), ios: 'n', android: 'n', thorvg: 'n', skottie: 'n' }),
  },

  /* ------------------------------ layer styles ----------------------------- */
  'style.dropShadow': {
    group: 'style',
    detect: 'sy[].ty === 1',
    spec: false,
    s: cells({ ...web('n'), android: 'n', thorvg: 'n', telegram: 'n' }),
  },
  'style.other': {
    group: 'style',
    detect: 'sy[].ty other than 1 (stroke, glows, bevel, overlays…)',
    spec: false,
    s: cells({
      ...web('n'),
      ios: 'n',
      android: 'n',
      thorvg: 'n',
      skottie: ['p', 'Inner shadow, glows and color overlay only'],
      telegram: 'n',
    }),
  },

  /* ---------------------------------- other -------------------------------- */
  expressions: {
    group: 'other',
    detect: 'a property with an expression string (x)',
    spec: false,
    s: cells({
      ...web(['y', 'Full builds only (uses eval)']),
      ios: ['n', 'The static value is used'],
      android: ['n', 'The static value is used'],
      thorvg: ['p', 'Most of the After Effects expression API'],
      skottie: ['n', 'Only when the embedder installs an ExpressionManager'],
      telegram: TG_REJECTED,
    }),
  },
  slots: {
    group: 'other',
    detect: 'root.slots or any property with sid',
    spec: true,
    s: cells({
      ios: ['p', 'Slots ignored: default values are used'],
      android: ['p', 'Slots ignored: default values are used'],
    }),
    since: { 'web-svg': '5.11.0', 'web-canvas': '5.11.0', 'web-html': '5.11.0' },
  },
  'image.external': {
    group: 'other',
    detect: 'image asset with e !== 1 and a p that is not a data URI',
    spec: true,
    // Reported by validation (image.external) with a more specific message.
    s: cells(),
  },
  'image.sequence': {
    group: 'other',
    detect: "image asset t === 'seq'",
    spec: false,
    s: cells({ android: ['y', 'One bitmap per frame: memory heavy'] }),
  },
} as const satisfies Record<string, FeatureDef>

export type FeatureId = keyof typeof FEATURES
export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[]

/** Effect match names that only Skottie renders (effects are matched by `mn` first). */
export const SKOTTIE_ONLY_EFFECT_MN: readonly string[] = [
  'ADBE Black&White',
  'ADBE Brightness & Contrast 2',
  'ADBE Bulge',
  'ADBE Corner Pin',
  'ADBE Displacement Map',
  'ADBE Easy Levels2',
  'ADBE Fractal Noise',
  'ADBE HUE SATURATION',
  'ADBE Invert',
  'ADBE Linear Wipe',
  'ADBE Motion Blur',
  'ADBE Radial Wipe',
  'ADBE Ramp',
  'ADBE Sharpen',
  'ADBE Shift Channels',
  'ADBE Threshold2',
  'ADBE Tile',
  'ADBE Venetian Blinds',
  'CC Sphere',
  'CC Toner',
]

/* -------------------------------------------------------------------------- */
/*                                   Targets                                  */
/* -------------------------------------------------------------------------- */

/**
 * Deployment targets offered by the UI; a target reports the worst level of its players.
 * "All players" covers the general-purpose players. The lottie-web HTML renderer (rarely used)
 * and Telegram (strict sticker rules) are only checked when chosen explicitly.
 */
export const TARGETS = {
  all: ['web-svg', 'web-canvas', 'ios', 'android', 'thorvg', 'skottie'],
  web: ['web-svg', 'web-canvas'],
  ios: ['ios'],
  android: ['android'],
  dotlottie: ['thorvg'],
  telegram: ['telegram'],
} as const satisfies Record<string, readonly PlayerId[]>

export type TargetId = keyof typeof TARGETS
export const TARGET_IDS = Object.keys(TARGETS) as TargetId[]

const RANK: Record<Level, number> = { y: 0, '?': 1, p: 2, n: 3, x: 4 }

/** Support level and note of a feature in one player. */
export function cellOf(id: FeatureId, player: PlayerId): { level: Level; note?: string } {
  const c: Cell = FEATURES[id].s[player]
  return typeof c === 'string' ? { level: c } : { level: c[0], note: c[1] }
}

export function levelRank(level: Level): number {
  return RANK[level]
}

export function worstLevel(levels: readonly Level[]): Level {
  let worst: Level = 'y'
  for (const l of levels) if (RANK[l] > RANK[worst]) worst = l
  return worst
}

export interface TargetVerdict {
  level: Level
  perPlayer: { player: PlayerId; level: Level; note?: string }[]
}

/** How well a target supports a feature (worst level among its players). */
export function verdict(id: FeatureId, target: TargetId): TargetVerdict {
  const perPlayer = TARGETS[target].map((player) => ({ player, ...cellOf(id, player) }))
  return { level: worstLevel(perPlayer.map((p) => p.level)), perPlayer }
}

/** Diagnostic severity for a support level (null when fully supported). */
export function severityFor(level: Level): 'error' | 'warning' | 'info' | null {
  switch (level) {
    case 'x':
      return 'error'
    case 'n':
      return 'warning'
    case 'p':
    case '?':
      return 'info'
    default:
      return null
  }
}

/** Players (of any target) where a feature is not fully supported, with their level. */
export function affectedPlayers(id: FeatureId): { player: PlayerId; level: Level }[] {
  const out: { player: PlayerId; level: Level }[] = []
  for (const player of PLAYERS) {
    const { level } = cellOf(id, player)
    if (level !== 'y') out.push({ player, level })
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                               JSON helpers                                 */
/* -------------------------------------------------------------------------- */

export type Json = Record<string, unknown>

export function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** The value when it is a finite number. */
export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/* -------------------------------------------------------------------------- */
/*                                Document scan                               */
/* -------------------------------------------------------------------------- */

export interface CompRef {
  /** Asset id of the precomposition, or null for the root composition. */
  id: string | null
  assetIndex: number | null
  name: string
  /** Path of the `layers` array. */
  layersPath: NodePath
  layers: LayerRef[]
  /** Rendered from the root composition (directly or through other precomps). */
  reachable: boolean
}

export interface LayerRef {
  layer: Json
  path: NodePath
  index: number
  comp: CompRef
}

export interface ShapeRef {
  item: Json
  path: NodePath
  layer: LayerRef
  /** Enclosing group, or null at the top of the layer. */
  group: ShapeRef | null
}

export type PropertyKind = 'value' | 'path' | 'text'

export interface PropertyRef {
  prop: Json
  path: NodePath
  layer: LayerRef
  /** 'path' for bezier shapes (shape paths, mask paths), 'text' for text documents. */
  kind: PropertyKind
}

export interface DocumentScan {
  comps: CompRef[]
  /** Precomposition comps by asset id (first asset wins, like lottie-web). */
  compById: Map<string, CompRef>
  layers: LayerRef[]
  shapes: ShapeRef[]
  properties: PropertyRef[]
}

function isPathValue(v: unknown): boolean {
  return isObj(v) && Array.isArray(v.v)
}

function propertyKind(prop: Json): PropertyKind {
  const k = prop.k
  if (isPathValue(k)) return 'path'
  if (Array.isArray(k) && isObj(k[0])) {
    const kf = k[0]
    const s = Array.isArray(kf.s) ? kf.s[0] : Array.isArray(kf.e) ? kf.e[0] : undefined
    if (isPathValue(s)) return 'path'
  }
  return 'value'
}

function scanProperties(ref: LayerRef, out: PropertyRef[]): void {
  // Iterative walk with explicit paths: documents can have hundreds of thousands of nodes.
  const stack: [unknown, NodePath][] = []
  const layer = ref.layer
  for (const key of Object.keys(layer)) {
    // Shape items and everything else are walked; nested compositions live in assets.
    const value = layer[key]
    if (typeof value === 'object' && value !== null) stack.push([value, [...ref.path, key]])
  }
  while (stack.length) {
    const [value, path] = stack.pop()!
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        const child = value[i]
        if (typeof child === 'object' && child !== null) stack.push([child, [...path, i]])
      }
      continue
    }
    const o = value as Json
    const n = path.length
    // The text document (t.d) is a keyframed property of its own kind.
    if (n === ref.path.length + 2 && path[n - 2] === 't' && path[n - 1] === 'd') {
      out.push({ prop: o, path, layer: ref, kind: 'text' })
      continue
    }
    if (isPropertyLike(o)) {
      out.push({ prop: o, path, layer: ref, kind: propertyKind(o) })
      continue
    }
    const keys = Object.keys(o)
    for (let i = keys.length - 1; i >= 0; i--) {
      const child = o[keys[i]]
      if (typeof child === 'object' && child !== null) stack.push([child, [...path, keys[i]]])
    }
  }
}

function scanShapes(
  items: unknown,
  base: NodePath,
  layer: LayerRef,
  group: ShapeRef | null,
  out: ShapeRef[],
): void {
  if (!Array.isArray(items)) return
  items.forEach((item, i) => {
    if (!isObj(item)) return
    const ref: ShapeRef = { item, path: [...base, i], layer, group }
    out.push(ref)
    if (item.ty === 'gr') scanShapes(item.it, [...ref.path, 'it'], layer, ref, out)
  })
}

const scanCache = new WeakMap<object, DocumentScan>()

/**
 * Indexes every composition, layer, shape item and animatable property of a document with its
 * JSON path. The result is cached per document object (immutable documents are rescanned only
 * when they change); use `buildScan` for objects that are mutated afterwards.
 */
export function scanDocument(anim: Animation): DocumentScan {
  const cached = scanCache.get(anim)
  if (cached) return cached
  const scan = buildScan(anim)
  scanCache.set(anim, scan)
  return scan
}

/** Uncached `scanDocument`. */
export function buildScan(anim: Animation): DocumentScan {
  const root = anim as unknown as Json
  const comps: CompRef[] = [
    {
      id: null,
      assetIndex: null,
      name: str(root.nm) ?? '',
      layersPath: ['layers'],
      layers: [],
      reachable: true,
    },
  ]
  const compById = new Map<string, CompRef>()
  arr(root.assets).forEach((asset, index) => {
    if (!isObj(asset) || !Array.isArray(asset.layers)) return
    const id = typeof asset.id === 'string' ? asset.id : String(asset.id ?? '')
    const comp: CompRef = {
      id,
      assetIndex: index,
      name: str(asset.nm) ?? id,
      layersPath: ['assets', index, 'layers'],
      layers: [],
      reachable: false,
    }
    comps.push(comp)
    if (!compById.has(id)) compById.set(id, comp)
  })

  const layers: LayerRef[] = []
  const shapes: ShapeRef[] = []
  const properties: PropertyRef[] = []
  for (const comp of comps) {
    const list =
      comp.assetIndex === null ? root.layers : (arr(root.assets)[comp.assetIndex] as Json).layers
    arr(list).forEach((layer, index) => {
      if (!isObj(layer)) return
      const ref: LayerRef = { layer, path: [...comp.layersPath, index], index, comp }
      comp.layers.push(ref)
      layers.push(ref)
      if (layer.ty === 4) scanShapes(layer.shapes, [...ref.path, 'shapes'], ref, null, shapes)
      scanProperties(ref, properties)
    })
  }

  // Reachability: follow precomp layers from the root; glyph precomps count as used.
  const queue: CompRef[] = [comps[0]]
  const visit = (id: unknown) => {
    const comp = typeof id === 'string' ? compById.get(id) : undefined
    if (comp && !comp.reachable) {
      comp.reachable = true
      queue.push(comp)
    }
  }
  for (const c of arr(root.chars)) if (isObj(c) && isObj(c.data)) visit(c.data.refId)
  while (queue.length) {
    const comp = queue.shift()!
    for (const l of comp.layers) if (l.layer.ty === 0) visit(l.layer.refId)
  }

  return { comps, compById, layers, shapes, properties }
}

/* -------------------------------------------------------------------------- */
/*                              Feature detection                             */
/* -------------------------------------------------------------------------- */

export interface FeatureHit {
  /** Number of occurrences. */
  count: number
  /** Paths of the occurrences (capped, see `detectFeatures`). */
  paths: NodePath[]
}

export type FeatureHits = Map<FeatureId, FeatureHit>

/** A property is "non-default" when animated, or static and different from `def`. */
function propDiffers(p: unknown, def: number): boolean {
  if (!isObj(p)) return false
  const k = p.k
  if (Array.isArray(k)) return k.some((v) => (isObj(v) ? true : typeof v === 'number' && v !== def))
  return typeof k === 'number' && k !== def
}

/** Gradient `g` has opacity stops when its values (or first keyframe) are longer than p × 4. */
function gradientHasOpacity(g: unknown): boolean {
  if (!isObj(g) || !isObj(g.k)) return false
  const p = num(g.p) ?? 0
  const k = g.k.k
  if (!Array.isArray(k) || k.length === 0) return false
  const values = isObj(k[0]) ? arr(k[0].s) : k
  return values.length > p * 4
}

const LAYER_FEATURE: Partial<Record<number, FeatureId>> = {
  0: 'layer.precomp',
  1: 'layer.solid',
  2: 'layer.image',
  3: 'layer.null',
  4: 'layer.shape',
  5: 'layer.text',
  6: 'layer.audio',
  13: 'layer.camera',
  15: 'layer.data',
}

const EFFECT_FEATURE: Partial<Record<number, FeatureId>> = {
  5: 'fx.expressionControls',
  20: 'fx.tint',
  21: 'fx.fill',
  22: 'fx.stroke',
  23: 'fx.tritone',
  24: 'fx.levels',
  25: 'fx.dropShadow',
  26: 'fx.skottieOnly',
  27: 'fx.skottieOnly',
  28: 'fx.setMatte',
  29: 'fx.gaussianBlur',
  35: 'fx.transform',
}

const MATTE_FEATURE: Partial<Record<number, FeatureId>> = {
  1: 'matte.alpha',
  2: 'matte.alphaInverted',
  3: 'matte.luma',
  4: 'matte.lumaInverted',
}

const SHAPE_FEATURE: Partial<Record<string, FeatureId>> = {
  sr: 'paint.polystar',
  rp: 'mod.repeater',
  rd: 'mod.roundCorners',
  mm: 'mod.mergePaths',
  op: 'mod.offsetPath',
  zz: 'mod.zigZag',
  pb: 'mod.puckerBloat',
  tw: 'mod.twist',
}

/** Text documents (source text keyframe values) of a text layer. */
export function textDocuments(layer: Json): Json[] {
  const t = isObj(layer.t) ? layer.t : null
  const d = t && isObj(t.d) ? t.d : null
  return arr(d?.k).flatMap((kf) => (isObj(kf) && isObj(kf.s) ? [kf.s] : []))
}

/**
 * Finds every feature the document uses, with the paths of the nodes that use it.
 * At most `limit` paths are kept per feature (the count is exact).
 */
export function detectFeatures(anim: Animation, limit = 5000): FeatureHits {
  const scan = scanDocument(anim)
  const root = anim as unknown as Json
  const hits: FeatureHits = new Map()
  const hit = (id: FeatureId, path: NodePath) => {
    let entry = hits.get(id)
    if (!entry) {
      entry = { count: 0, paths: [] }
      hits.set(id, entry)
    }
    entry.count++
    if (entry.paths.length < limit) entry.paths.push(path)
  }

  // Glyphs vs fonts classification.
  const fonts = arr(isObj(root.fonts) ? root.fonts.list : undefined).filter(isObj)
  const chars = arr(root.chars).filter(isObj)
  const hasGlyphsFor = (fName: unknown): boolean => {
    const font = fonts.find((f) => f.fName === fName)
    if (!font) return false
    return chars.some((c) => c.fFamily === font.fFamily && c.style === font.fStyle)
  }

  for (const ref of scan.layers) {
    const { layer, path } = ref
    const ty = num(layer.ty)
    hit((ty !== undefined && LAYER_FEATURE[ty]) || 'layer.unsupportedType', path)
    if (layer.hd === true) hit('layer.hidden', path)
    if (layer.mb === true) hit('layer.motionBlur', path)
    if (isObj(layer.tm)) hit('time.remap', [...path, 'tm'])
    if (num(layer.sr) !== undefined && layer.sr !== 1) hit('time.stretch', path)
    const ks = isObj(layer.ks) ? layer.ks : {}
    if (layer.ddd === 1 || 'rx' in ks || 'ry' in ks || 'or' in ks) hit('transform.3d', path)
    if (layer.ao === 1) hit('transform.autoOrient', path)
    if (propDiffers(ks.sk, 0)) hit('transform.layerSkew', [...path, 'ks', 'sk'])

    const bm = num(layer.bm) ?? 0
    if (bm >= 1 && bm <= 5) hit('blend.basic', path)
    else if (bm >= 6 && bm <= 15) hit('blend.advanced', path)
    else if (bm === 16) hit('blend.add', path)
    else if (bm === 17) hit('blend.hardMix', path)

    const tt = num(layer.tt) ?? 0
    const matte = MATTE_FEATURE[tt]
    if (matte) hit(matte, path)
    if (typeof layer.tp === 'number') hit('matte.parent', path)
    if (layer.td && tt > 0) hit('matte.nested', path)

    const masks = arr(layer.masksProperties)
    if (masks.length > 0) hit('mask.any', path)
    masks.forEach((m, mi) => {
      if (!isObj(m)) return
      const mp = [...path, 'masksProperties', mi]
      const mode = m.mode
      if (mode === 'a') hit('mask.add', mp)
      else if (mode === 's') hit('mask.subtract', mp)
      else if (mode === 'i') hit('mask.intersect', mp)
      else if (mode === 'l' || mode === 'd') hit('mask.lightenDarken', mp)
      else if (mode === 'f') hit('mask.difference', mp)
      if (m.inv === true) hit('mask.inverted', mp)
      if (propDiffers(m.o, 100)) hit('mask.opacity', mp)
      if (propDiffers(m.x, 0)) hit('mask.expansion', mp)
      if (propDiffers(m.f, 0)) hit('mask.feather', mp)
    })

    if (ty === 5 && isObj(layer.t)) {
      const t = layer.t
      if (arr(t.a).length > 0) hit('text.animators', [...path, 't', 'a'])
      if (isObj(t.p) && typeof t.p.m === 'number') hit('text.path', [...path, 't', 'p'])
      const fontNames = new Set(textDocuments(layer).map((doc) => doc.f))
      for (const f of fontNames)
        hit(hasGlyphsFor(f) ? 'text.glyphs' : 'text.fonts', [...path, 't', 'd'])
    }

    const effects = arr(layer.ef)
    if (effects.length > 0) hit('fx.any', path)
    effects.forEach((e, ei) => {
      if (!isObj(e)) return
      const ep = [...path, 'ef', ei]
      const ety = num(e.ty)
      const byTy = ety !== undefined ? EFFECT_FEATURE[ety] : undefined
      if (byTy) hit(byTy, ep)
      else if (typeof e.mn === 'string' && SKOTTIE_ONLY_EFFECT_MN.includes(e.mn))
        hit('fx.skottieOnly', ep)
      else hit('fx.unknown', ep)
    })
    arr(layer.sy).forEach((s, si) => {
      if (isObj(s)) hit(s.ty === 1 ? 'style.dropShadow' : 'style.other', [...path, 'sy', si])
    })
  }

  for (const { item, path } of scan.shapes) {
    if (item.hd === true) hit('paint.hiddenShape', path)
    if (typeof item.bm === 'number' && item.bm !== 0) hit('blend.shape', path)
    const ty = item.ty
    switch (ty) {
      case 'gf':
      case 'gs':
        hit('paint.gradient', path)
        if (ty === 'gs') hit('paint.gradientStroke', path)
        if (gradientHasOpacity(item.g)) hit('paint.gradientOpacity', path)
        if (ty === 'gf' && item.r === 2) hit('paint.fillRuleEvenOdd', path)
        if (ty === 'gs' && arr(item.d).length > 0) hit('paint.strokeDash', path)
        break
      case 'fl':
        if (item.r === 2) hit('paint.fillRuleEvenOdd', path)
        break
      case 'st':
        if (arr(item.d).length > 0) hit('paint.strokeDash', path)
        break
      case 'tm':
        hit(item.m === 2 ? 'mod.trimIndividually' : 'mod.trim', path)
        break
      default: {
        const feature = typeof ty === 'string' ? SHAPE_FEATURE[ty] : undefined
        if (feature) hit(feature, path)
      }
    }
  }

  arr(root.assets).forEach((a, i) => {
    if (!isObj(a) || Array.isArray(a.layers) || typeof a.p !== 'string') return
    if (a.t === 'seq') hit('image.sequence', ['assets', i])
    if (a.e !== 1 && !/^data:/i.test(a.p)) hit('image.external', ['assets', i])
  })

  if (isObj(root.slots) && Object.keys(root.slots).length > 0) hit('slots', ['slots'])
  for (const { prop, path } of scan.properties) {
    if (typeof prop.x === 'string' && prop.x.trim()) hit('expressions', path)
    if (typeof prop.sid === 'string') hit('slots', path)
  }
  return hits
}

/* -------------------------------------------------------------------------- */
/*                                Graph checks                                */
/* -------------------------------------------------------------------------- */

/**
 * How a player family pairs a track-matted layer with its matte source:
 *  - 'web-svg' (also ThorVG, Skottie, lottie-ios main): `tp` by ind, else the layer above
 *  - 'web-canvas': `tp`, else the layer whose ind is this ind − 1
 *  - 'adjacent' (lottie-android, lottie-ios ≤ 4.6.1): always the layer above
 */
export type MatteSemantics = 'web-svg' | 'web-canvas' | 'adjacent'

/** Index of the matte source of `layers[i]` in a player family, or -1 if none. */
export function matteSourceIndex(layers: readonly Json[], i: number, sem: MatteSemantics): number {
  const layer = layers[i]
  if (!layer || !(num(layer.tt) ?? 0)) return -1
  if (sem !== 'adjacent' && typeof layer.tp === 'number')
    return layers.findIndex((l) => l.ind === layer.tp)
  if (sem === 'web-canvas') {
    const ind = num(layer.ind)
    return ind === undefined ? -1 : layers.findIndex((l) => l.ind === ind - 1)
  }
  return i - 1
}

/**
 * Parent loops (including self-parenting): each loop once, as layer indices in walking order
 * starting from its lowest index. lottie-web overflows the stack on these; Android loops forever.
 */
export function findParentCycles(layers: readonly Json[]): number[][] {
  const byInd = new Map<number, number>()
  layers.forEach((l, i) => {
    const ind = num(l.ind)
    if (ind !== undefined && !byInd.has(ind)) byInd.set(ind, i)
  })
  const parentOf = (i: number): number | undefined => {
    const p = num(layers[i]?.parent)
    return p === undefined ? undefined : byInd.get(p)
  }
  const cycles: number[][] = []
  const done = new Set<number>()
  for (let start = 0; start < layers.length; start++) {
    if (done.has(start)) continue
    const order: number[] = []
    const position = new Map<number, number>()
    let cur: number | undefined = start
    while (cur !== undefined && !done.has(cur) && !position.has(cur)) {
      position.set(cur, order.length)
      order.push(cur)
      cur = parentOf(cur)
    }
    if (cur !== undefined && position.has(cur)) {
      const loop = order.slice(position.get(cur))
      const min = loop.indexOf(Math.min(...loop))
      cycles.push([...loop.slice(min), ...loop.slice(0, min)])
    }
    for (const i of order) done.add(i)
  }
  return cycles
}

/** Precomposition asset ids that contain themselves (directly or through other precomps). */
export function findPrecompCycles(anim: Animation): string[] {
  const refs = new Map<string, string[]>()
  for (const a of arr((anim as unknown as Json).assets)) {
    if (!isObj(a) || typeof a.id !== 'string' || !Array.isArray(a.layers)) continue
    if (refs.has(a.id)) continue
    refs.set(
      a.id,
      a.layers
        .filter(isObj)
        .flatMap((l) => (l.ty === 0 && typeof l.refId === 'string' ? [l.refId] : [])),
    )
  }
  const cyclic = new Set<string>()
  const state = new Map<string, 1 | 2>() // 1 = on the stack, 2 = done
  const dfs = (id: string, stack: string[]): void => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) {
      stack.slice(stack.indexOf(id)).forEach((s) => cyclic.add(s))
      return
    }
    state.set(id, 1)
    stack.push(id)
    for (const next of refs.get(id) ?? []) if (refs.has(next)) dfs(next, stack)
    stack.pop()
    state.set(id, 2)
  }
  for (const id of refs.keys()) dfs(id, [])
  return [...cyclic]
}
