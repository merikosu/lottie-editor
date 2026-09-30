/** Strings of the "assets" feature. Keep keys in sync with ../ru/assets.ts (type-checked). */
import { pluralEn } from '../../plural'

const assets = {
  filter: 'Filter assets',
  add: 'Add asset',
  addImageHint: 'Add image…',
  addFontHint: 'Add font…',
  more: 'More actions',
  rowActions: 'Actions',

  sections: {
    images: 'Images',
    compositions: 'Precompositions',
    fonts: 'Fonts',
  },
  empty: {
    images: 'No images yet.',
    imagesAction: 'Add image…',
    compositions: 'No precompositions.',
    fonts: 'No fonts.',
    fontsAction: 'Add font…',
    filtered: 'Nothing matches the filter.',
  },

  status: {
    linked: 'Linked',
    missing: 'Missing',
  },
  statusHint: {
    linked: 'Downloaded from the web when the animation plays',
    missing: 'The file is not inside the animation, so players show nothing. Embed it to fix this.',
  },

  usage: (n: number) => `×${n}`,
  usedBy: (n: number) =>
    n === 0
      ? 'Not used by any layer — safe to remove'
      : `Used by ${pluralEn(n, 'layer', 'layers')}`,
  unreachable: 'Only used inside unused precompositions — safe to remove',
  layerCount: (n: number) => pluralEn(n, 'layer', 'layers'),
  textLayerCount: (n: number) => pluralEn(n, 'text layer', 'text layers'),
  sizeUnknown: 'Size unknown',

  actions: {
    replace: 'Replace…',
    locate: 'Locate file…',
    embed: 'Embed image',
    download: 'Download',
    rename: 'Rename',
    renameId: 'Change ID',
    copyId: 'Copy ID',
    copyName: 'Copy name',
    selectLayers: (n: number) =>
      n === 1 ? 'Select the layer' : `Select ${pluralEn(n, 'layer', 'layers')}`,
    showInJson: 'Show in JSON',
    delete: 'Delete',
    edit: 'Edit…',
    addImage: 'Image…',
    addFont: 'Font…',
    removeUnused: 'Remove unused assets',
    embedMissing: 'Embed missing images…',
  },
  dropToReplace: 'Drop to replace',
  preview: (w: number, h: number) => `${w} × ${h} px`,

  idEmpty: 'The ID can’t be empty',
  idTaken: 'Another asset already uses this ID',

  errors: {
    read: (name: string) => `Couldn’t read “${name}” as an image`,
    readHint: 'Use a PNG, JPEG, WebP, GIF or SVG file.',
    download: 'Couldn’t save the image',
    fetch: (name: string) => `Couldn’t download “${name}”`,
    fetchHint: 'The server doesn’t allow it. Save the file yourself and use “Locate file…”.',
  },
  unmatched: (n: number) => `${pluralEn(n, 'file doesn’t', 'files don’t')} match a missing image`,
  unmatchedHint: 'Missing images are matched by file name.',
  noMatches: 'None of these files match a missing image',

  replaceDialog: {
    title: 'Replace image',
    description: (id: string) =>
      `The new image has a different shape than “${id}”. How should it fit?`,
    current: 'Current',
    next: 'New',
    fit: 'Fit inside the current size',
    fitHint: 'Nothing is cropped',
    fill: 'Crop to the current size',
    fillHint: 'The edges are cut off to fill it',
    natural: 'Use the image’s own size',
    naturalHint: 'It may appear larger or smaller',
    confirm: 'Replace',
  },

  font: {
    family: 'Family',
    style: 'Style',
    name: 'Name',
    nameHint: 'Text layers refer to the font by this name',
    source: 'Source',
    familyRequired: 'Enter a font family',
    available: 'Installed on this device',
    unavailable: 'Not installed on this device — the preview uses a fallback font',
    origins: {
      local: 'Local',
      css: 'Web font',
      script: 'Web font (JS)',
      file: 'Font file',
    },
    addTitle: 'Add font',
    editTitle: 'Edit font',
    add: 'Add',
    save: 'Save',
    undefinedFonts: (names: string) => `Text uses unlisted fonts: ${names}`,
  },

  history: {
    replaceImage: 'Replace image',
    addImage: 'Add image',
    addImages: (n: number) => `Add ${pluralEn(n, 'image', 'images')}`,
    embedImages: (n: number) => `Embed ${pluralEn(n, 'image', 'images')}`,
    renameAsset: 'Change asset ID',
    renameImage: 'Rename image',
    renameComposition: 'Rename precomposition',
    deleteAsset: 'Delete asset',
    removeUnused: 'Remove unused assets',
    addFont: 'Add font',
    editFont: 'Edit font',
    removeFont: 'Remove font',
  },

  commands: {
    replaceImage: 'Replace image…',
    removeUnused: 'Remove unused assets',
    embedMissing: 'Embed missing images…',
    show: 'Show assets',
  },
}

export default assets
