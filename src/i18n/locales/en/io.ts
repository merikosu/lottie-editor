/** Strings of the "io" feature (open, save, autosave, welcome screen). Keep keys in sync with ../ru/io.ts. */
import { pluralEn } from '../../plural'

const io = {
  title: 'Files',

  commands: {
    new: 'New animation…',
    open: 'Open…',
    openUrl: 'Open from URL…',
    samples: 'Samples…',
    download: 'Download',
    close: 'Close',
    revert: 'Revert to original…',
    switchAnimation: 'Switch animation…',
    clearRecents: 'Clear recent files',
    openRecent: (name: string) => `Open recent: ${name}`,
    autosave: 'Autosave in this browser',
  },

  history: {
    revert: 'Revert to original',
    embedImages: (n: number) => (n === 1 ? 'Embed image' : `Embed ${n} images`),
  },

  welcome: {
    tagline: 'Edit Lottie and dotLottie files in your browser. Files stay on this device.',
    dropTitle: 'Drop a Lottie file here',
    dropHintOr: 'or paste JSON or a link',
    openFile: 'Open file…',
    newAnimation: 'New animation',
    openUrl: 'Open from URL',
    opening: (name: string) => `Opening “${name}”…`,
    recent: 'Recent',
    clearRecents: 'Clear',
    clearConfirm: 'Remove all recent files from this browser?',
    clearConfirmAction: 'Remove all',
    addedToRecent: (name: string, n: number) =>
      `Opened “${name}”. ${pluralEn(n, 'other file was', 'other files were')} added to Recent.`,
    showMore: (n: number) => `Show ${n} more`,
    showLess: 'Show less',
    samples: 'Samples',
    samplesHint: 'Original animations, free to use and edit',
  },

  recent: {
    edited: (when: string) => `Edited ${when}`,
    opened: (when: string) => `Opened ${when}`,
    remove: 'Remove from recent',
    open: 'Open',
    download: 'Download copy',
    missing: (name: string) => `“${name}” is no longer stored in this browser`,
    missingHint: 'Browser data may have been cleared. The file was removed from Recent.',
  },

  samples: {
    names: {
      bounce: 'Bouncing ball',
      loader: 'Loader',
      success: 'Success',
      like: 'Like',
      'gradient-blob': 'Gradient blob',
      typing: 'Typing',
      toggle: 'Toggle',
      orbit: 'Orbit',
    },
    features: {
      bounce: 'Squash and stretch, motion path',
      loader: 'Trim paths, rotation, round caps',
      success: 'Draw-on stroke, overshoot',
      like: 'Repeater burst, scale pop',
      'gradient-blob': 'Path morphing, gradient fills',
      typing: 'Text keyframes, parenting',
      toggle: 'Color animation, stretch',
      orbit: 'Reused precomp, null, parenting',
    },
    dialogTitle: 'Samples',
    dialogDescription: 'Opening a sample replaces the current animation. It stays in Recent.',
    dialogDescriptionNoAutosave: 'Opening a sample replaces the current animation.',
  },

  drop: {
    open: 'Drop to open',
    replaces: (name: string) => `Replaces “${name}”. It stays in Recent.`,
    replacesNoAutosave: (name: string) => `Replaces “${name}”`,
    images: 'Drop images to add',
    imagesHint: 'Adds them to the current animation',
    imagesNoDoc: 'Open an animation first',
    imagesNoDocHint: 'Images are added to an open animation',
    optimize: 'Drop to optimize',
    optimizeHint: 'Files are added to the queue',
    optimizeImages: 'Only animations can be optimized',
    customizeImages: 'Drop to replace the selected element',
    customizeImagesHint: 'SVG or image — fit and colors can be adjusted next',
    optimizeImagesHint: 'Drop .json, .lottie, .tgs or .zip files',
  },

  save: {
    saving: 'Saving…',
    saved: 'Saved on this device',
    savedTooltip: (time: string) =>
      `Autosaved in this browser at ${time}. Browser data can be cleared — download a copy to keep it.`,
    savingTooltip: 'Saving changes in this browser',
    notSavedQuota: 'Not saved: storage full',
    notSavedUnavailable: 'Not saved: storage unavailable',
    errorTooltip:
      'Your latest changes are only in this tab. Download a copy so you don’t lose them.',
    downloadCopy: 'Download copy',
  },

  restore: {
    restored: (name: string) => `Restored “${name}”`,
    edited: (when: string) => `Edited ${when}`,
    opened: (when: string) => `Opened ${when}`,
    startFresh: 'Start fresh',
  },

  time: {
    justNow: 'just now',
  },

  /** File size units (1 KB = 1024 bytes). */
  units: { B: 'B', KB: 'KB', MB: 'MB', GB: 'GB' },

  newDoc: {
    title: 'New animation',
    name: 'Name',
    namePlaceholder: 'Untitled',
    size: 'Size',
    presets: {
      square: 'Square',
      post: 'Post',
      landscape: 'Landscape',
      portrait: 'Portrait',
      icon: 'Icon',
      custom: 'Custom',
    },
    anySize: 'Any size',
    widthShort: 'W',
    heightShort: 'H',
    swap: 'Swap width and height',
    frameRate: 'Frame rate',
    customFps: 'Custom',
    duration: 'Duration',
    frames: (n: number) => pluralEn(n, 'frame', 'frames'),
    create: 'Create',
  },

  openUrl: {
    title: 'Open from URL',
    description: 'A direct link to a .json, .lottie or .tgs file.',
    placeholder: 'https://example.com/animation.json',
    open: 'Open',
    connecting: 'Connecting…',
    downloading: (loaded: string, total: string | null) =>
      total ? `Downloading ${loaded} of ${total}` : `Downloading ${loaded}`,
    reading: 'Reading the file…',
    invalid: 'Enter a link that starts with https://',
    githubRewritten: 'GitHub page links are opened as raw files.',
  },

  picker: {
    title: 'Choose an animation',
    description: (file: string, n: number) =>
      `“${file}” contains ${n} animations. The others are kept and saved with the file.`,
    descriptionList: (file: string, n: number) =>
      `“${file}” contains ${n} animations. Choose one to open.`,
    descriptionPaste: (n: number) =>
      `The pasted JSON contains ${n} animations. Choose one to open.`,
    search: 'Filter animations',
    noMatches: 'No animations match',
    initial: 'Default',
    current: 'Open now',
    switchTitle: 'Switch animation',
    switchDescription: 'Your changes to the current animation are kept in the file.',
  },

  confirm: {
    revertTitle: 'Revert to the original file?',
    revertDescription: 'All changes since the file was opened are replaced. You can undo this.',
    revert: 'Revert',
    discardTitle: 'Discard unsaved changes?',
    discardDescription: (name: string) =>
      `“${name}” has changes that are not saved anywhere because autosave is off.`,
    discard: 'Discard',
    downloadFirst: 'Download copy',
  },

  errors: {
    openTitle: (name: string) => `Couldn’t open “${name}”`,
    openTitleGeneric: 'Couldn’t open the file',
    empty: 'The file is empty.',
    invalidJsonAt: (found: string, line: number, column: number) =>
      `It isn’t valid JSON: unexpected ${found} at line ${line}, column ${column}.`,
    invalidJsonEnd: (line: number) =>
      `It isn’t valid JSON: the file ends too early (line ${line}).`,
    invalidJson: 'It isn’t valid JSON.',
    lineBreak: 'line break',
    quote: (s: string) => `“${s}”`,
    notLottie: 'This JSON isn’t a Lottie animation.',
    hints: {
      'dotlottie-manifest':
        'It looks like the manifest of a .lottie file. Open the .lottie file itself.',
      theme: 'It looks like a dotLottie theme. Open the .lottie file that contains it.',
      'state-machine':
        'It looks like a dotLottie state machine. Open the .lottie file that contains it.',
      partial:
        'It looks like part of an animation (layers or shapes without the composition settings).',
    },
    corruptZip: 'The archive is damaged or isn’t a ZIP file.',
    noAnimation: 'The archive doesn’t contain a Lottie animation.',
    corruptGzip: 'The Telegram sticker is damaged: it isn’t valid gzip data.',
    html: 'This is a web page, not an animation file. Use the direct link to the .json or .lottie file.',
    image: 'Images can’t be opened as animations.',
    imageNoDoc: 'Open or create an animation first, then drop images to add them.',
    unsupported: (ext: string) =>
      ext
        ? `.${ext} files aren’t supported. Open .json, .lottie, .tgs or .zip files.`
        : 'This file type isn’t supported. Open .json, .lottie, .tgs or .zip files.',
    readFailed: 'The browser couldn’t read the file.',
    unexpected: 'Something went wrong while opening the file.',
    network:
      'The server can’t be reached or doesn’t allow loading from other sites. Download the file and open it instead.',
    http: (status: number, text: string) =>
      `The server responded with ${status}${text ? ` (${text})` : ''}.`,
    tooLarge: 'The file is too large to open in the browser.',
    downloadTitle: 'Couldn’t download the file',
    storageTitle: 'Browser storage error',
    storageFull:
      'The browser’s storage for this site is full. Remove some recent files or download copies.',
    storageUnavailable: 'Browser storage is unavailable, for example in a private window.',
    saveFailed: 'Couldn’t save the file',
    saveUnexpected:
      'Something went wrong while writing it. Try again, or export it in another format.',
    v2Required: 'Themes and state machines need dotLottie 2.',
    tooManyFiles: (name: string, n: number) =>
      `Opened “${name}”. One animation can be open at a time, so ${pluralEn(n, 'other file was', 'other files were')} skipped.`,
  },

  warnings: {
    repairs: (n: number) => `Opened with ${pluralEn(n, 'automatic repair', 'automatic repairs')}`,
    notes: (n: number) => `Opened with ${pluralEn(n, 'warning', 'warnings')}`,
    both: (repairs: number, warnings: number) =>
      `Opened with ${pluralEn(repairs, 'repair', 'repairs')} and ${pluralEn(warnings, 'warning', 'warnings')}`,
    more: (n: number) => `and ${n} more`,
    'no-manifest':
      'The .lottie file has no manifest, so some players may reject it. Saving writes a proper one.',
    'invalid-manifest': 'The manifest is damaged and was ignored.',
    'missing-animation': (id: string) => `The manifest lists “${id}”, but its file is missing.`,
    'unlisted-animation': (path: string) => `“${path}” isn’t listed in the manifest.`,
    'invalid-animation': (path: string) => `“${path}” isn’t a valid animation and was skipped.`,
    'missing-asset': (id: string) => `Image “${id}” is missing from the file.`,
    'external-asset': (id: string) => `Image “${id}” is loaded from the internet.`,
    'missing-entry': (id: string) => `“${id}” is listed in the manifest but missing.`,
    'invalid-entry': (path: string) => `“${path}” is damaged and was kept as is.`,
    'skipped-entry': (path: string) => `“${path}” couldn’t be unpacked and was skipped.`,
    salvaged: 'The archive was damaged; the readable files were recovered.',
    'corrupt-entry': (path: string) => `“${path}” is damaged and was skipped.`,
    'external-images': (n: number, names: string) =>
      `${pluralEn(n, 'image is', 'images are')} stored outside the file (${names}). Drop the image files onto the window to embed them.`,
  },

  repairs: {
    frameRate: (value: string) => `Invalid frame rate (${value}) replaced with 30 fps.`,
    inPoint: 'Missing start frame set to 0.',
    outPoint: 'Invalid end frame repaired.',
    width: 'Invalid width replaced with 512.',
    height: 'Invalid height replaced with 512.',
    layers: 'Missing layer list created.',
  },
}

export default io
