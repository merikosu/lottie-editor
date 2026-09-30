/** Strings of the "themes" feature. Keep keys in sync with ../ru/themes.ts (type-checked). */
import { pluralEn } from '../../plural'

const themes = {
  title: 'Themes',
  defaultTheme: 'Default',
  themeGroup: 'Theme',
  newTheme: 'New theme',
  newThemeName: (n: number) => `Theme ${n}`,
  themeName: 'Theme name',
  copyName: (name: string) => `${name} copy`,

  empty: {
    hint: 'Theme colors let players switch color sets, such as light and dark, in one file.',
    add: 'Add theme color',
  },
  noThemes: 'Add a theme to give these colors other values.',

  /* ------------------------------- Colors -------------------------------- */
  addColor: 'Add color',
  picker: {
    title: 'Make a theme color',
    hint: 'Everything that uses the color follows the theme.',
    none: 'Every color that can follow a theme already does.',
    unsupported: 'Gradients, animated colors and solid layers can’t be theme colors.',
    swatch: (hex: string, uses: string) => `${hex} · ${uses}`,
    uses: (n: number) => pluralEn(n, 'use', 'uses'),
  },
  slotName: 'Name',

  /* -------------------------------- Rows --------------------------------- */
  row: {
    inherited: 'Same as Default',
    animated: 'Animated',
    animatedHint: 'Animated value. Choosing a color makes it static.',
    unused: 'Not used by any layer',
    uses: (n: number, layers: number) =>
      `${pluralEn(n, 'use', 'uses')} in ${pluralEn(layers, 'layer', 'layers')}`,
    readOnly: 'Edit this value in the JSON editor',
    reset: 'Reset to Default',
    edit: (name: string) => `Edit ${name}`,
  },
  kinds: {
    color: 'Color',
    scalar: 'Number',
    vector: 'Vector',
    position: 'Position',
    gradient: 'Gradient',
    image: 'Image',
    text: 'Text',
    path: 'Path',
    unknown: 'Value',
  },
  roles: {
    'fill-color': 'Fill',
    'stroke-color': 'Stroke',
    'text-color': 'Text color',
    'effect-color': 'Effect color',
    'style-color': 'Layer style',
    gradient: 'Gradient',
    opacity: 'Opacity',
    'stroke-width': 'Stroke width',
    rotation: 'Rotation',
    scalar: 'Number',
    position: 'Position',
    anchor: 'Anchor point',
    scale: 'Scale',
    size: 'Size',
    text: 'Text',
    image: 'Image',
    path: 'Path',
    other: 'Property',
  },

  /* -------------------------------- Menus -------------------------------- */
  menu: {
    rename: 'Rename',
    duplicate: 'Duplicate',
    deleteTheme: 'Delete theme',
    initial: 'Players start with this theme',
    copyThemeId: 'Copy theme ID',
    editColor: 'Edit color…',
    editValue: 'Edit value…',
    selectLayers: 'Select layers',
    showInJson: 'Show in JSON',
    copySlotId: 'Copy ID',
    reset: 'Reset to Default',
    remove: 'Remove from themes',
  },
  chip: {
    initial: 'Players start with this theme',
    id: (id: string) => `ID for code: ${id}`,
  },
  copyFailed: 'Couldn’t copy to the clipboard',

  /* ----------------------------- Validation ------------------------------ */
  errors: {
    empty: 'Enter a name',
    nameTaken: 'This name is already used',
    invalidId: 'Up to 64 characters, no spaces at the ends',
    unsupported: 'Telegram stickers can’t hold themes.',
  },

  /* ---------------------------- Colors panel ----------------------------- */
  badge: (name: string) => `Theme color “${name}”: every use changes with it`,
  bind: {
    make: 'Make a theme color',
    bound: (name: string) => `Theme color: ${name}`,
  },

  /* ------------------------------- Saving -------------------------------- */
  savedIn: 'Themes are saved in .lottie files.',
  exportLink: 'Export…',

  /* ------------------------------- Preview ------------------------------- */
  preview: {
    badge: (name: string) => `Theme: ${name}`,
    stop: 'Show Default',
    reveal: 'Show themes',
  },

  /* ------------------------------- Export -------------------------------- */
  export: {
    label: 'Themes',
    include: 'Include themes',
    needsV2: 'Themes need dotLottie 2.',
  },

  /* ------------------------------- History ------------------------------- */
  history: {
    makeColor: 'Make theme color',
    renameColor: 'Rename theme color',
    removeColor: 'Remove theme color',
    editDefault: 'Change theme color',
    newTheme: 'New theme',
    renameTheme: 'Rename theme',
    duplicateTheme: 'Duplicate theme',
    deleteTheme: 'Delete theme',
    editTheme: 'Change theme value',
    resetValue: 'Reset theme value',
    initialTheme: 'Change starting theme',
  },

  /* ------------------------------ Commands ------------------------------- */
  commands: {
    show: 'Themes',
    newTheme: 'New theme',
    stopPreview: 'Show default theme',
    export: 'Export with themes…',
  },
}

export default themes
