/** Strings of the "optimizer" feature. Keep keys in sync with ../ru/optimizer.ts (type-checked). */
import { pluralEn } from '../../plural'

const files = (n: number) => pluralEn(n, 'file', 'files')
const frames = (n: number) => pluralEn(n, 'frame', 'frames')

const optimizer = {
  title: 'Optimizer',

  start: {
    title: 'Optimize Lottie files',
    description:
      'Smaller files, identical animation — verified frame by frame. Files never leave your device.',
    choose: 'Choose files…',
    optimizeDocument: (name: string) => `Optimize “${name}”`,
    manyAtOnce: 'many at once',
    paste: 'or paste JSON or a link',
    trySample: 'No file at hand? Try a sample:',
  },

  presets: {
    label: 'Preset',
    safe: 'Safe',
    balanced: 'Balanced',
    maximum: 'Maximum',
    custom: 'Custom',
    about: {
      safe: 'Exact changes only. The result is pixel-identical.',
      balanced: 'Sub-pixel precision and leaner keyframes. Looks identical.',
      maximum: 'Larger tolerances, WebP images, fewer names. Review the result.',
      custom: 'Your own choice of techniques and tolerances.',
    },
    recommended: 'Recommended',
  },

  output: {
    label: 'Output',
    same: 'Same as input',
    json: 'JSON',
    lottie: '.lottie',
    several: 'Several animations are saved as one .lottie',
  },

  /** Format chips. */
  formats: { json: 'JSON', lottie: '.lottie', tgs: '.tgs', zip: 'ZIP', editor: 'Editor' },

  queue: {
    label: 'Files to optimize',
    files,
    animations: (n: number) => pluralEn(n, 'animation', 'animations'),
    progress: (done: number, total: number) => `${done} of ${files(total)} done`,
    totalsHint: 'Minified JSON of the files that are done. gzip is what a web server sends.',
    gzip: 'gzip',
    identical: (n: number) => (n === 1 ? 'Identical' : `All ${n} identical`),
    toReview: (n: number) => `${files(n)} to review`,
    failed: (n: number) => `${files(n)} failed`,
    addFiles: 'Add files…',
    downloadAll: 'Download all',
    downloadAllHint: 'Every optimized file in one ZIP',
    downloadAllPartial: (n: number) => `The files that are ready (${files(n)} still in progress)`,
    clear: 'Clear',
    settings: 'Settings for all files',
    dropMore: 'Drop more files anywhere on the page',
    ownSettings: 'Own settings',
    ownSettingsHint: 'This file has its own settings',
    columns: { file: 'File', size: 'Size', saved: 'Saved', check: 'Visual check' },
  },

  status: {
    reading: 'Reading…',
    queued: 'Waiting…',
    optimizing: 'Optimizing…',
    verifying: 'Checking frames…',
    checkQueued: 'Waiting to be checked',
    adjusting: 'Adjusting settings…',
    done: 'Done',
    error: 'Failed',
  },

  verify: {
    identical: 'Identical',
    identicalHint: (n: number) => `Checked ${frames(n)}: no visible difference`,
    pixelIdenticalHint: (n: number) => `Checked ${frames(n)}: pixel-identical`,
    review: (share: string) => `Δ ${share} — review`,
    reviewHint: (share: string, frame: number) =>
      `Up to ${share} of the pixels differ (frame ${frame}). Compare before using the file.`,
    unverified: 'Not checked',
    unverifiedHint: 'The frames could not be rendered for the check.',
    checking: 'Checking…',
  },

  row: {
    open: 'Show details',
    download: (format: string) => `Download ${format}`,
    downloadAs: 'Download as',
    openInEditor: 'Open in editor',
    remove: 'Remove',
    retry: 'Try again',
  },

  detail: {
    back: 'All files',
    position: (index: number, total: number) => `${index} of ${total}`,
    previous: 'Previous file',
    next: 'Next file',
    animation: 'Animation',
    replace: 'Replace in editor',
    replaceHint: 'Puts the optimized animation into the editor as one undo step',
    replaced: 'Applied in the editor',
    replacedHint: 'The editor shows the optimized animation. Undo there to go back.',
    stale: 'Edited since it was sent here',
    staleHint: 'The editor has newer changes than this result.',
    optimizeCurrent: 'Optimize current version',
    download: 'Download',
    removed: 'This file is no longer in the queue',
  },

  compare: {
    label: 'Comparison',
    side: 'Side by side',
    swipe: 'Swipe',
    difference: 'Difference',
    original: 'Original',
    optimized: 'Optimized',
    background: 'Background',
    backgrounds: { checker: 'Checkerboard', dark: 'Dark', light: 'Light' },
    play: 'Play',
    pause: 'Pause',
    scrub: 'Frame',
    divider: 'Comparison divider',
    amplify: 'Amplify differences',
    differenceHint: 'Black means identical',
    worstFrame: (frame: number) => `Worst frame: ${frame}`,
    worstFrameHint: 'Jump to the frame where the check found the largest difference',
    heatmap: 'Differences found by the check',
    noDifference: (n: number) => `Checked ${frames(n)}: no visible difference`,
    failed: 'This animation could not be played',
    fit: 'Fit',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
  },

  result: {
    title: 'Result',
    saved: 'saved',
    json: 'JSON',
    gzip: 'gzip',
    lottie: '.lottie',
    measuring: 'Measuring sizes',
    time: (duration: string) => `Optimized in ${duration}`,
    relaxed: 'Relaxed to keep the animation identical:',
    backoff: {
      imageQuality: (from: string, to: string) => `image quality ${from} → ${to}`,
      tolerance: (from: string, to: string) => `tolerance ${from} → ${to}`,
      disable: (techniques: string) => `${techniques} off`,
    },
    notSmaller: 'Already as small as these settings allow',
    wholeFile: (n: number) => `All ${n} animations (JSON):`,
  },

  tabs: { savings: 'Savings', settings: 'Settings', details: 'Details' },

  savings: {
    legendRaw: 'JSON',
    legendGzip: 'gzip',
    unchanged: 'Nothing to do',
    note: 'A web server sends JSON gzipped, and a .lottie is a zip archive: that compression happens on delivery. These bars show what optimization removes before it.',
    total: 'Total',
    none: 'No technique changed this file with these settings.',
    share: (percent: string) => `${percent} of the saving`,
  },

  techniques: {
    minify: { name: 'Minify', about: 'Removes whitespace and line breaks.' },
    legacy: {
      name: 'Legacy format',
      about: 'Rewrites keyframes of old Bodymovin exports in the shorter modern form.',
    },
    hidden: { name: 'Hidden content', about: 'Removes hidden layers and shapes.' },
    invisible: {
      name: 'Invisible content',
      about: 'Removes layers and paints that are fully transparent whenever they are shown.',
    },
    empty: {
      name: 'Empty layers',
      about: 'Removes layers that are never on screen and groups that draw nothing.',
    },
    unusedAssets: {
      name: 'Unused assets',
      about: 'Removes precompositions, images and fonts that nothing uses.',
    },
    dedupeAssets: {
      name: 'Duplicate assets',
      about: 'Merges identical precompositions and images.',
    },
    staticize: {
      name: 'Constant animations',
      about: 'Turns properties whose keyframes never change the value into static ones.',
    },
    keyframes: {
      name: 'Keyframes',
      about: 'Removes keyframes the motion already passes through, within the tolerance.',
    },
    paths: { name: 'Paths', about: 'Removes duplicate points and points on straight lines.' },
    precision: {
      name: 'Number precision',
      about: 'Rounds every number to the precision it needs to look the same on screen.',
    },
    defaults: { name: 'Default values', about: 'Removes fields every player assumes anyway.' },
    names: {
      name: 'Names',
      about: 'Removes names. Code that finds layers or shapes by name stops matching them.',
    },
    images: {
      name: 'Images',
      about: 'Re-encodes embedded images and scales them down to the size they are shown at.',
    },
  },

  categories: { lossless: 'Lossless', visual: 'Visually lossless', lossy: 'Lossy' },

  /** What a technique changed (report details), for tooltips. */
  changes: {
    layers: (n: number) => pluralEn(n, 'layer', 'layers'),
    shapes: (n: number) => pluralEn(n, 'shape', 'shapes'),
    groups: (n: number) => pluralEn(n, 'group', 'groups'),
    keyframes: (n: number) => pluralEn(n, 'keyframe', 'keyframes'),
    properties: (n: number) => pluralEn(n, 'property', 'properties'),
    static: (n: number) => `${pluralEn(n, 'property', 'properties')} made static`,
    vertices: (n: number) => pluralEn(n, 'path point', 'path points'),
    paths: (n: number) => pluralEn(n, 'path', 'paths'),
    numbers: (n: number) => pluralEn(n, 'number', 'numbers'),
    fields: (n: number) => pluralEn(n, 'field', 'fields'),
    names: (n: number) => pluralEn(n, 'name', 'names'),
    classes: (n: number) => pluralEn(n, 'class or id', 'classes and ids'),
    assets: (n: number) => pluralEn(n, 'asset', 'assets'),
    fonts: (n: number) => pluralEn(n, 'font', 'fonts'),
    glyphs: (n: number) => pluralEn(n, 'glyph', 'glyphs'),
    references: (n: number) => pluralEn(n, 'reference', 'references'),
    images: (n: number) => pluralEn(n, 'image', 'images'),
    downscaled: (n: number) => `${pluralEn(n, 'image', 'images')} downscaled`,
    endValues: (n: number) => pluralEn(n, 'end value', 'end values'),
    easingNames: (n: number) => pluralEn(n, 'easing name', 'easing names'),
    other: (n: number) => pluralEn(n, 'change', 'changes'),
    removed: 'Removed or changed:',
  },

  settings: {
    fileScope: 'These settings apply to this file only.',
    queueScope: 'Settings for every file that has no settings of its own.',
    followsQueue: 'This file uses the settings for all files.',
    applyToAll: 'Use for all files',
    reset: 'Go back to the settings for all files',
    geometry: 'Geometry and motion',
    structure: 'Structure and data',
    names: 'Names',
    images: 'Images',
    verification: 'Visual check',
    tolerance: 'Tolerance',
    toleranceHint:
      'Largest change allowed, in pixels of the animation. 0 allows exact changes only.',
    keyframeShare: 'Keyframe share',
    keyframeShareHint:
      'How much of the tolerance keyframe simplification may use; number precision gets the rest.',
    simplifyPaths: 'Simplify paths within the tolerance',
    format: 'Format',
    formats: { auto: 'Auto', webp: 'WebP', jpeg: 'JPEG', png: 'PNG' },
    quality: 'Quality',
    maxScale: 'Largest size',
    maxScaleHint:
      'Largest bitmap kept, as a multiple of the biggest size the image is shown at. 0 keeps the original size.',
    keepSize: 'Keep',
    nameScope: 'Remove',
    nameScopes: { shapes: 'Shape names', exceptLayers: 'All but layers', all: 'All names' },
    classes: 'Also CSS classes and ids',
    guarantee: 'Keep the result identical',
    guaranteeHint: 'When the check finds a difference, safer settings are tried until it passes.',
    everyFrame: 'Check every frame',
    everyFrameHint: 'Slower on long animations. Otherwise 60 frames spread over the animation.',
    noImages: 'This file has no embedded images.',
    lossy: 'Lossy',
  },

  content: {
    title: 'Content',
    before: 'Before',
    after: 'After',
    rows: {
      layers: 'Layers',
      shapes: 'Shapes',
      keyframes: 'Keyframes',
      animated: 'Animated properties',
      compositions: 'Precompositions',
      expressions: 'Expressions',
      numbers: 'Numbers',
      decimals: 'Decimals (typical)',
      images: 'Images',
      imageBytes: 'Image data',
    },
    animation: 'Animation',
    size: 'Size',
    frameRate: 'Frame rate',
    duration: 'Duration',
    version: 'Bodymovin',
    imagesTitle: 'Images',
    imageActions: {
      reencoded: 'Re-encoded',
      downscaled: 'Downscaled',
      kept: 'Kept',
      skipped: 'Skipped',
    },
    warnings: 'Notes',
    noWarnings: 'Nothing to note.',
  },

  warnings: {
    expressions: (n: number) =>
      `${pluralEn(n, 'expression', 'expressions')}: techniques that could break them were limited.`,
    namesStripped: 'Names were removed: code that finds layers by name no longer matches them.',
    classesStripped: 'CSS classes and ids were removed.',
    hiddenGroups:
      'Hidden groups were removed (lottie-web draws them anyway, other players do not).',
    webp: 'Images are now WebP: iOS 14, Safari 14 and Android 4.3 or later.',
    imagesDownscaled: 'Images were scaled down to the largest size they are shown at.',
    imagesUnavailable: 'Images could not be re-encoded in this browser.',
    imageDecodeFailed: 'Some images could not be decoded and were kept as they were.',
    legacyFormat: 'Old Bodymovin format: its conventions were kept.',
    slots: 'Properties bound to themes (slots) were left untouched.',
    threeD: '3D layers: number precision stays conservative.',
    precompCycle: 'Some precompositions contain themselves: those parts were skipped.',
    singleKeyframes: 'Properties with a single keyframe became static.',
  },

  downloads: {
    title: 'Download',
    json: 'JSON',
    lottie: '.lottie',
    tgs: '.tgs',
    jsonOne: 'JSON of this animation',
    smallest: 'Smallest to deliver',
    telegram: 'Telegram sticker',
    notTelegram: 'Not a valid Telegram sticker',
    notReady: 'Available when the file is optimized',
  },

  commands: {
    optimize: 'Optimize…',
    chooseFiles: 'Add files to optimize…',
    downloadAll: 'Download all optimized files',
    clear: 'Clear the optimizer queue',
    presetSafe: 'Optimizer preset: Safe',
    presetBalanced: 'Optimizer preset: Balanced',
    presetMaximum: 'Optimizer preset: Maximum',
    back: 'Back to all files',
    next: 'Next file',
    previous: 'Previous file',
    compareSide: 'Compare side by side',
    compareSwipe: 'Compare with a swipe',
    compareDifference: 'Show differences',
    download: 'Download this file',
    replace: 'Replace in editor',
  },

  units: { ms: 'ms', s: 's', px: 'px' },

  history: {
    replace: 'Optimize',
  },

  errors: {
    failed: 'The optimizer failed',
    download: (name: string) => `Could not create “${name}”`,
    archive: 'Could not create the ZIP',
  },
}

export default optimizer
