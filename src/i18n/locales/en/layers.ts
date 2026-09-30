import { pluralEn } from '../../plural'

/** Strings of the "layers" feature. Keep keys in sync with ../ru/layers.ts (type-checked). */
const layers = {
  title: 'Layers',
  treeLabel: 'Layers and shapes',
  searchPlaceholder: 'Search layers',
  clearSearch: 'Clear search',
  addLayer: 'Add layer',
  collapseAll: 'Collapse all',

  /** Items of the "+" menu. */
  newLayer: {
    section: 'New layer',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    star: 'Star',
    polygon: 'Polygon',
    text: 'Text',
    solid: 'Solid',
    null: 'Null',
    image: 'Image…',
  },
  addToShape: (name: string) => `Add to “${name}”`,
  shapeItems: {
    rect: 'Rectangle path',
    ellipse: 'Ellipse path',
    star: 'Star path',
    polygon: 'Polygon path',
    fill: 'Fill',
    stroke: 'Stroke',
    gradientFill: 'Gradient fill',
    trimPaths: 'Trim paths',
    repeater: 'Repeater',
    roundCorners: 'Round corners',
    group: 'Group',
  },

  /** Names given to new layers and items ("Rectangle 1", "Fill 1", …). */
  defaultNames: {
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    star: 'Star',
    polygon: 'Polygon',
    text: 'Text',
    solid: 'Solid',
    null: 'Null',
    shapeLayer: 'Shape layer',
    group: 'Group',
    rectPath: 'Rectangle path',
    ellipsePath: 'Ellipse path',
    starPath: 'Star path',
    polygonPath: 'Polygon path',
    fill: 'Fill',
    stroke: 'Stroke',
    gradientFill: 'Gradient fill',
    trimPaths: 'Trim paths',
    repeater: 'Repeater',
    roundCorners: 'Round corners',
  },
  /** Content of a new text layer. */
  defaultText: 'Text',
  /** Appended to names of duplicates (with a leading space). */
  copySuffix: ' copy',

  empty: {
    title: 'No layers',
    description: 'Add a shape, text or image.',
  },
  noResults: {
    title: 'No matches',
    description: (query: string) => `No names contain “${query}”.`,
  },

  /** Row affordances and tooltips. */
  row: {
    expand: 'Expand',
    collapse: 'Collapse',
    hide: 'Hide',
    show: 'Show',
    lock: 'Lock',
    unlock: 'Unlock',
    locked: 'Locked: cannot be selected on the canvas',
    soloed: 'Solo: other layers are hidden in the preview',
    parent: (name: string) => `Parent: ${name}`,
    missingParent: (ind: number) => `Parent layer ${ind} is missing`,
    usage: (n: number) => `Used by ${pluralEn(n, 'layer', 'layers')}. Edits apply to all of them.`,
    recursive: 'This composition contains itself',
    animatedColor: 'Animated color',
  },
  matte: {
    alpha: 'Alpha matte',
    alphaInverted: 'Inverted alpha matte',
    luma: 'Luma matte',
    lumaInverted: 'Inverted luma matte',
    target: (type: string, source: string) => `${type} from “${source}”`,
    missing: (type: string) => `${type}: the matte layer is missing`,
    source: (targets: string[]) =>
      targets.length
        ? `Track matte for ${targets.map((n) => `“${n}”`).join(', ')}`
        : 'Unused track matte',
  },

  /** Context menu. */
  menu: {
    rename: 'Rename',
    arrange: 'Arrange',
    setParent: 'Parent',
    noParent: 'None',
    add: 'Add',
    newLayer: 'New layer',
    selectParent: 'Select parent',
    selectChildren: 'Select children',
    zoomTo: 'Zoom to layer',
    showInJson: 'Show in JSON',
    solo: 'Solo',
    unsolo: 'Unsolo',
    ungroupBlocked: {
      transform: 'Has a transform',
      styles: 'Would restyle shapes',
    },
  },

  /** Command titles (menus, command palette). */
  commands: {
    newRect: 'New rectangle layer',
    newEllipse: 'New ellipse layer',
    newStar: 'New star layer',
    newPolygon: 'New polygon layer',
    newText: 'New text layer',
    newSolid: 'New solid layer',
    newNull: 'New null layer',
    newImage: 'New image layer…',
    duplicate: 'Duplicate',
    delete: 'Delete',
    copy: 'Copy',
    cut: 'Cut',
    paste: 'Paste',
    selectAll: 'Select all',
    rename: 'Rename',
    toggleVisibility: 'Hide/show',
    toggleLock: 'Lock/unlock',
    toggleSolo: 'Solo',
    bringToFront: 'Bring to front',
    bringForward: 'Bring forward',
    sendBackward: 'Send backward',
    sendToBack: 'Send to back',
    group: 'Group',
    ungroup: 'Ungroup',
    selectParent: 'Select parent',
    selectChildren: 'Select children',
    collapseAll: 'Collapse all layers',
    focusTree: 'Go to layer list',
    precompose: 'Precompose…',
    unprecompose: 'Release precomp layers',
  },

  /** Undo history labels; `what` is one of the `count` phrases below. */
  history: {
    addLayer: (name: string) => `Add “${name}”`,
    addShapeItem: (name: string) => `Add “${name}”`,
    duplicate: (what: string) => `Duplicate ${what}`,
    delete: (what: string) => `Delete ${what}`,
    cut: (what: string) => `Cut ${what}`,
    paste: (what: string) => `Paste ${what}`,
    rename: (what: string) => `Rename ${what}`,
    hide: (what: string) => `Hide ${what}`,
    show: (what: string) => `Show ${what}`,
    move: (what: string) => `Move ${what}`,
    group: 'Group',
    ungroup: 'Ungroup',
    setParent: 'Set parent',
    clearParent: 'Remove parent',
    precompose: (name: string) => `Precompose “${name}”`,
    release: (n: number) => (n === 1 ? 'Release precomp' : `Release ${n} precomps`),
  },
  /** Objects of history labels: "Delete layer", "Delete 3 layers", "Hide item". */
  count: {
    layers: (n: number) => (n === 1 ? 'layer' : pluralEn(n, 'layer', 'layers')),
    items: (n: number) => (n === 1 ? 'item' : pluralEn(n, 'item', 'items')),
  },

  drag: {
    items: (n: number) => pluralEn(n, 'item', 'items'),
  },

  /** Precompose dialog (After Effects' wording). */
  precompose: {
    title: 'Precompose',
    descriptionOne: (name: string) => `Moves “${name}” into a new composition.`,
    descriptionMany: (n: number) => `Moves ${n} layers into a new composition.`,
    name: 'Name',
    /** Numbered default names: "Pre-comp 1" for several layers, "Ball Comp 1" for one. */
    defaultName: 'Pre-comp',
    layerCompName: (layer: string) => `${layer} Comp`,
    move: 'Move all attributes into the new composition',
    moveHint: 'Transforms, masks and effects go with the layers.',
    leave: (comp: string) => `Leave all attributes in “${comp}”`,
    leaveHere: 'Leave all attributes in this composition',
    leaveHint: 'The transform, masks and effects stay on the new layer.',
    leaveUnavailable: {
      multiple: 'Available for one layer',
      kind: 'Available for a solid, image or precomp layer',
      size: 'The layer has no size of its own',
    },
    size: (w: string, h: string) => `${w} × ${h}`,
    adjust: 'Adjust composition duration to the time span of the selected layers',
    span: (from: string, to: string) => `Selected layers: frames ${from}–${to}`,
    notes: {
      mattesOne: (name: string) => `Also moves its track matte layer “${name}”.`,
      mattesMany: (n: number) =>
        `Also moves ${pluralEn(n, 'track matte layer', 'track matte layers')}.`,
      copiedOne: (name: string) =>
        `The parent “${name}” stays here: a null copy inside keeps the layers in place.`,
      copiedMany: (n: number) =>
        `${pluralEn(n, 'parent stays', 'parents stay')} here: null copies inside keep the layers in place.`,
      leftOne: (name: string) =>
        `“${name}” also parents layers that stay: a null copy of it stays here.`,
      leftMany: (n: number) =>
        `${pluralEn(n, 'moved layer parents', 'moved layers parent')} layers that stay: null copies stay here.`,
      between: (n: number) =>
        `${pluralEn(n, 'layer', 'layers')} between the selected ones will be below the new composition.`,
      blendModes: 'Blend modes will only mix with layers inside the new composition.',
      expressions: 'Expressions that refer to other layers may need updating.',
    },
    apply: 'Precompose',
  },

  /** Release precomp layers ("unprecompose"). */
  release: {
    /** Why a precomp layer cannot be released: short, for menus. */
    blocked: {
      missing: 'No composition',
      recursive: 'Contains itself',
      timeRemap: 'Time remapping',
      stretch: 'Reversed time',
      matte: 'Track matte',
      masks: 'Has masks',
      effects: 'Has effects',
      styles: 'Has layer styles',
      blend: 'Blend mode',
    },
    /** The same reasons as sentences, for notifications. */
    blockedHint: {
      missing: 'Its composition is not in the file.',
      recursive: 'Its composition contains the one it is in.',
      timeRemap: 'Time remapping only works on a precomp layer.',
      stretch: 'Layers cannot play in reverse outside a composition.',
      matte: 'Its track matte applies to the whole composition.',
      masks: 'Its masks apply to the whole composition.',
      effects: 'Its effects apply to the whole composition.',
      styles: 'Its layer styles apply to the whole composition.',
      blend: 'Its blend mode applies to the whole composition.',
    },
    failedOne: (name: string) => `Could not release “${name}”`,
    failedMany: 'Could not release the selected layers',
    skipped: (n: number) =>
      `${pluralEn(n, 'precomp layer was', 'precomp layers were')} not released`,
    changed: 'The animation may look different',
    reveals: 'Content outside the composition frame is now visible.',
    opacity: 'Its opacity now applies to each layer separately.',
    blendModes: 'Blend modes now also mix with the layers below.',
  },

  errors: {
    imageRead: 'Could not read the image',
    imageReadHint: 'Use a PNG, JPEG, WebP, GIF or SVG file.',
    recursivePaste: 'A composition cannot contain itself: its layer was not pasted',
    clipboard: 'Could not read the clipboard',
    clipboardHint: (shortcut: string) => `Allow clipboard access, or press ${shortcut} to paste.`,
  },
}

export default layers
