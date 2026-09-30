/** Strings of the "export" feature. Keep keys in sync with ../ru/export.ts (type-checked). */
import { pluralEn } from '../../plural'

const exportNs = {
  title: 'Export',

  groups: {
    animation: 'Animation files',
    video: 'Video & GIF',
    images: 'Images',
    developers: 'Developers',
  },

  formats: {
    json: { name: 'Lottie JSON', hint: 'For web and mobile apps' },
    dotlottie: { name: 'dotLottie', hint: 'Compressed, images inside' },
    tgs: { name: 'Telegram sticker', hint: 'Animated .tgs sticker' },
    gif: { name: 'GIF', hint: 'Plays everywhere, 256 colors' },
    mp4: { name: 'Video (MP4)', hint: 'H.264 for social media' },
    webm: { name: 'Video (WebM)', hint: 'VP9 with transparency' },
    png: { name: 'PNG sequence', hint: 'Every frame in a ZIP' },
    framePng: { name: 'Frame (PNG)', hint: 'One frame as an image' },
    frameSvg: { name: 'Frame (SVG)', hint: 'One frame as vectors' },
    embed: { name: 'Embed code', hint: 'Snippets for web pages' },
  },
  notAvailable: 'Not available in this browser',
  previewLabel: 'Preview of the exported file',

  /* ------------------------------ Footer ------------------------------ */
  fileName: 'File name',
  export: 'Export',
  copy: 'Copy',
  copied: 'Copied',
  copyCode: 'Copy code',
  download: (name: string) => `Download ${name}`,
  cancel: 'Cancel',
  exporting: 'Exporting…',
  preparing: 'Preparing…',
  finishing: 'Finishing…',
  rendering: (done: number, total: number) => `Rendering ${done} / ${total} frames`,
  secondsLeft: (s: number) => (s <= 1 ? 'about a second left' : `${s} s left`),
  cancelHint: 'Stop exporting',

  summary: {
    frames: (from: number, to: number) => (from === to ? `Frame ${from}` : `Frames ${from}–${to}`),
    seconds: (s: string) => `${s} s`,
    repeated: (times: number, s: string) => `${times} × ${s} s`,
    countAt: (n: number, fps: string) => `${pluralEn(n, 'frame', 'frames')} at ${fps} fps`,
    size: (w: number, h: number) => `${w} × ${h}`,
    estimate: (size: string) => `≈ ${size}`,
    gzip: (size: string) => `${size} gzipped`,
    files: (n: number) => pluralEn(n, 'file', 'files'),
    of: (size: string, limit: string) => `${size} of ${limit}`,
    measuring: 'Measuring…',
  },

  /* ------------------------------ Options ----------------------------- */
  fields: {
    size: 'Size',
    frameRate: 'Frame rate',
    range: 'Range',
    background: 'Background',
    matte: 'Matte',
    threshold: 'Cutoff',
    colors: 'Colors',
    dithering: 'Dithering',
    palette: 'Palette',
    loop: 'Loop',
    quality: 'Quality',
    repeat: 'Plays',
    codec: 'Codec',
    frame: 'Frame',
    renderer: 'Renderer',
    formatting: 'Formatting',
    precision: 'Precision',
    names: 'Names',
    images: 'Images',
    version: 'Version',
    contents: 'Contents',
    autoplay: 'Autoplay',
    speed: 'Speed',
    direction: 'Direction',
    code: 'Code',
    player: 'Player',
    json: 'JSON',
    gzip: 'Gzipped',
    widthShort: 'W',
    heightShort: 'H',
  },

  sizes: {
    '0.5x': '0.5×',
    '1x': '1×',
    '2x': '2×',
    '3x': '3×',
    '4x': '4×',
    '720p': '720p',
    '1080p': '1080p',
    '4k': '4K',
    custom: 'Custom',
  },
  keepAspect: 'Keep aspect ratio',
  evenSize: 'Rounded to even numbers: video encoders need them.',
  sizeLimited: 'Reduced to the largest size browsers can render (8192 px, 16.7 megapixels).',
  letterbox: 'Other proportions than the animation: it is centered, with background around it.',

  fpsSource: 'source',
  fps: (fps: string) => `${fps} fps`,
  gifFpsCap: 'GIFs play at most 50 frames per second.',

  rangeAll: 'Whole animation',
  rangeWorkArea: 'Work area',
  rangeNoWorkArea: 'Set a work area in the timeline first (B and N).',

  bgColor: 'Color',
  bgTransparent: 'Transparent',
  matteHint: 'Soft edges are blended onto this color.',
  thresholdHint: 'Pixels less opaque than this become transparent.',

  paletteShared: 'Shared',
  palettePerFrame: 'Per frame',
  paletteHint:
    'Shared: one palette, smaller file, no flicker. Per frame: better colors for changing content.',
  ditherHint: 'Smoother gradients, larger file.',
  loopForever: 'Forever',
  loopOnce: 'Once',
  loopCustom: 'Custom',
  /** Unit after a play count ("3 times"). */
  times: (n: number): string => (n === 1 ? 'time' : 'times'),

  quality: { low: 'Low', medium: 'Medium', high: 'High' },
  playerLoop: 'Start over at the end',
  playerAutoplay: 'Play as soon as it loads',
  repeatHint: 'Plays the animation several times in a row, for sites with a minimum video length.',

  renderers: {
    auto: (name: string) => `Match canvas (${name})`,
    svg: 'SVG',
    canvas: 'Canvas',
  },
  rendererHint: 'SVG matches the editor preview exactly. Canvas is faster but skips some effects.',
  svgFontsNote:
    'Text with web fonts may render in a fallback font with the SVG renderer. Choose Canvas for exact fonts.',

  /* ------------------------------- Notes ------------------------------ */
  gifTransparencyNote:
    'GIF transparency is on or off per pixel, so soft edges look jagged. WebM keeps smooth transparency.',
  mp4NoAlpha: 'MP4 has no transparency. Choose WebM for a transparent video.',
  webmAlphaNote:
    'Transparent WebM plays in Chrome, Edge and Firefox. Safari shows a black background.',
  codecFallback: (name: string) =>
    `H.264 is not available in this browser, so the video uses ${name}.`,
  checkingEncoder: 'Checking the video encoder…',
  unsupported: {
    title: (container: string) => `This browser can't encode ${container} video`,
    noWebCodecs:
      'Video export uses WebCodecs, which is available in Chrome, Edge, Safari 16.4+ and Firefox 130+.',
    noCodec: (size: string) =>
      `No encoder accepts ${size} here. Try a smaller size or another frame rate.`,
    error: 'The video encoder could not be checked. Reload the page and try again.',
  },
  missingImagesNote: (n: number) =>
    n === 1
      ? '1 image is not inside the file and will be empty. Embed it in the Assets panel.'
      : `${n} images are not inside the file and will be empty. Embed them in the Assets panel.`,
  expressionsNote:
    'Expressions are off in the preview, so they are not rendered. Turn them on in the canvas settings.',

  /* ---------------------------- Lottie JSON --------------------------- */
  json: {
    minified: 'Minified',
    pretty: 'Readable',
    keepDecimals: 'All decimals',
    decimals: (n: number) => (n === 1 ? '1 decimal' : `${n} decimals`),
    precisionHint: 'Rounds coordinates and times. Colors and easing keep 3 decimals.',
    stripNames: 'Remove layer names',
    stripNamesWarning:
      'Expressions and runtime keypaths (dynamic properties in lottie-ios and lottie-android) stop working.',
    imagesEmbedded: 'Embedded',
    imagesFiles: 'Separate files',
    imagesFilesHint: 'Exports a .zip with the JSON and an images folder.',
    savings: (pct: string) => `${pct} smaller`,
    larger: (pct: string) => `${pct} larger`,
  },

  /* ----------------------------- dotLottie ---------------------------- */
  dotlottie: {
    auto: (v: number) => `Automatic · v${v}`,
    v1: 'dotLottie 1',
    v1Hint: 'widest support',
    v2: 'dotLottie 2',
    v2Hint: 'themes, state machines',
    v2Required: 'Themes and state machines of this file need dotLottie 2.',
    imagesAsFiles: 'Store images as files',
    includePackage: 'Include the rest of the file',
    packageAnimations: (n: number) => pluralEn(n, 'more animation', 'more animations'),
    packageThemes: (n: number) => pluralEn(n, 'theme', 'themes'),
    packageStateMachines: (n: number) => pluralEn(n, 'state machine', 'state machines'),
    normal: 'Forward',
    bounce: 'Ping-pong',
    playerHint:
      'Saved in the manifest; players that support it (lottie-ios, dotLottie players) start this way.',
    playerV2Hint: 'dotLottie 2 has no player settings: set loop and autoplay in your code.',
  },

  /* ------------------------------ Telegram ---------------------------- */
  tgs: {
    requirements: 'Telegram requirements',
    ready: 'Ready for Telegram',
    issues: (n: number) =>
      n === 1
        ? 'Telegram may reject this sticker: 1 issue.'
        : `Telegram may reject this sticker: ${n} issues.`,
    fixes: 'Fix on export',
    fixesHint: 'Fixes change the exported file only, never your document.',
    fitSize: 'Scale to 512 × 512',
    fixFps: 'Convert to 60 fps',
    longer: 'Longer than 3 s',
    keep: 'Keep',
    trim: 'Trim to 3 s',
    speedUp: 'Speed up to 3 s',
    checks: {
      size: 'Canvas 512 × 512',
      fps: '60 frames per second',
      duration: '3 seconds or less',
      fileSize: '64 KB or less compressed',
      expressions: 'Expressions',
      masks: 'Masks',
      effects: 'Layer effects',
      images: 'Images',
      solids: 'Solid layers',
      texts: 'Text layers',
      threeD: '3D layers',
      mergePaths: 'Merge paths',
      stars: 'Stars and polygons',
      gradientStrokes: 'Gradient strokes',
      repeaters: 'Repeaters',
      timeStretch: 'Time stretch',
      timeRemap: 'Time remapping',
      autoOrient: 'Auto-orient',
    },
    unsupportedFeatures: 'Unsupported features',
    noFeatures: 'None used',
    usedIn: (names: string) => `Used in ${names}`,
    count: (n: number) => `${n}`,
    sizeValue: (w: number, h: number) => `${w} × ${h}`,
    fpsValue: (fps: string) => `${fps} fps`,
    durationValue: (s: string) => `${s} s`,
  },

  /* ------------------------------- Frames ----------------------------- */
  frame: {
    playhead: 'Use the frame at the playhead',
    of: (last: number) => `of ${last}`,
    svgSizeHint: 'Sets the width and height of the SVG. It stays a vector image.',
    svgFontsNote:
      'Text uses web fonts that are not inside the SVG: other apps show it in a fallback font.',
  },

  /* ---------------------------- PNG sequence -------------------------- */
  sequenceFiles: (first: string, last: string) => `${first} … ${last}`,

  /* ----------------------------- Embed code --------------------------- */
  embed: {
    html: 'HTML',
    wc: 'Web component',
    react: 'React',
    htmlHint: 'lottie-web from jsDelivr, no build step.',
    wcHint: 'The dotLottie web component plays the .lottie file.',
    reactHint: 'The lottie-react component; the JSON is bundled with your app.',
    inline: 'Put the JSON in the code',
    inlineHint: 'No separate file to host.',
    inlineWarning: (size: string) =>
      `Adds ${size} to the page, and browsers can't cache it separately.`,
    hostHint: (name: string) => `Upload ${name} next to the page (Download below).`,
    importHint: (name: string) => `Put ${name} next to the component (Download below).`,
    jsonPlaceholder: (size: string) => `animation JSON, ${size}`,
    inlineSummary: 'JSON in the code',
  },

  /* ---------------------------- Results ------------------------------- */
  done: (name: string, size: string) => `Exported ${name} · ${size}`,
  downloadAgain: 'Download again',
  warnings: {
    missingImages: (n: number) =>
      n === 1 ? '1 missing image was left empty.' : `${n} missing images were left empty.`,
    unreachableImages: (n: number) =>
      n === 1
        ? '1 linked image could not be downloaded and was left empty.'
        : `${n} linked images could not be downloaded and were left empty.`,
    renderErrors: (n: number) =>
      n === 1 ? '1 frame had rendering errors.' : `${n} frames had rendering errors.`,
  },
  errors: {
    failed: 'The export failed',
    videoUnsupported: "This browser can't encode this video. Try WebM, another size, or Chrome.",
    clipboardImage: "This browser can't copy images. Use Export instead.",
    clipboard: "Couldn't copy to the clipboard",
    v2Required: 'Themes and state machines need dotLottie 2.',
    memory: 'Not enough memory. Try a smaller size or a shorter range.',
    tainted:
      "The browser didn't allow reading the rendered frames. Embed linked images and try again.",
    build: (detail: string) => `lottie-web could not build this animation: ${detail}`,
  },

  /* ----------------------------- Commands ----------------------------- */
  commands: {
    export: 'Export…',
    exportGif: 'Export as GIF…',
    exportMp4: 'Export as MP4 video…',
    exportWebm: 'Export as WebM video…',
    exportJson: 'Export as Lottie JSON…',
    exportDotLottie: 'Export as dotLottie…',
    exportTgs: 'Export as Telegram sticker…',
    exportPngSequence: 'Export as PNG sequence…',
    exportEmbed: 'Get embed code…',
    copyFramePng: 'Copy frame as PNG',
    copyFrameSvg: 'Copy frame as SVG',
    saveFramePng: 'Save frame as PNG',
    copyJson: 'Copy Lottie JSON',
  },
}

export default exportNs
