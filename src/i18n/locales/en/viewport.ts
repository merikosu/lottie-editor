import { pluralEn } from '../../plural'

/** Kinds of nodes moved together on the canvas (history label). */
export type MovedKind = 'layer' | 'group' | 'mixed'

/** Strings of the "viewport" feature. Keep keys in sync with ../ru/viewport.ts (type-checked). */
const viewport = {
  canvasLabel: 'Animation canvas',
  /** Cursor position readout in artboard pixels. */
  cursor: (x: number, y: number) => `x ${x} · y ${y}`,
  loading: 'Loading preview…',
  unknownError: 'Unknown error',

  zoom: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomFit: 'Zoom to fit',
  zoom100: 'Zoom to 100%',
  zoomSelection: 'Zoom to selection',

  background: 'Canvas background',
  backgrounds: {
    checker: 'Checker',
    dark: 'Dark',
    light: 'Light',
    custom: 'Custom',
  },
  backgroundCommands: {
    checker: 'Checkerboard background',
    dark: 'Dark background',
    light: 'Light background',
    custom: 'Custom background color',
  },
  backgroundCycle: 'Next canvas background',

  renderer: 'Renderer',
  rendererTooltip: (name: string) => `Renderer: ${name}`,
  renderers: {
    svg: 'SVG',
    canvas: 'Canvas',
  },
  rendererHints: {
    svg: 'Accurate, click layers to select',
    canvas: 'Faster, no selection on canvas',
  },
  canvasNoSelection: 'Selecting layers on the canvas needs the SVG renderer',

  bounds: 'Artboard outline',
  showBounds: 'Show artboard outline',
  compare: 'Compare with original',
  original: 'Original',
  edited: 'Edited',
  noChanges: 'No changes',

  previewFailed: 'Preview failed',
  /** lottie-web crashed on the file's data (the exception text is shown on hover). */
  errorInvalidData: 'lottie-web can’t render this file',
  showIssues: 'Show issues',
  tryAgain: 'Try again',
  dismiss: 'Dismiss',

  expressionsOff: 'Expressions off',
  expressionsOn: 'Expressions on',
  expressionsTitle: 'This file uses expressions',
  expressionsBody:
    'Expressions run JavaScript from the file. Turn them on only for files you trust.',
  expressionsEnable: 'Run expressions',

  /** Readouts next to the pointer while dragging on the canvas (numbers are preformatted). */
  dragPosition: (x: string, y: string) => `Position ${x}, ${y}`,
  dragOffset: (dx: string, dy: string) => `Δ ${dx}, ${dy}`,
  /** Size of the box being resized, in composition pixels. */
  readoutSize: (w: string, h: string) => `${w} × ${h}`,
  /** Its scale: one value when both axes are equal (`y` null). */
  readoutScale: (x: string, y: string | null) => (y === null ? `${x}%` : `${x}% × ${y}%`),
  /** Rotation while turning a layer or group. */
  readoutAngle: (degrees: string) => `${degrees}°`,

  /** History entry of a drag on the canvas. */
  historyMove: (n: number, kind: MovedKind) => {
    if (n === 1) return kind === 'group' ? 'Move group' : 'Move layer'
    if (kind === 'layer') return `Move ${pluralEn(n, 'layer', 'layers')}`
    if (kind === 'group') return `Move ${pluralEn(n, 'group', 'groups')}`
    return `Move ${pluralEn(n, 'item', 'items')}`
  },
  /** History entry of a resize with the canvas handles. */
  historyResize: (n: number, kind: MovedKind) => {
    if (n === 1) return kind === 'group' ? 'Resize group' : 'Resize layer'
    if (kind === 'layer') return `Resize ${pluralEn(n, 'layer', 'layers')}`
    if (kind === 'group') return `Resize ${pluralEn(n, 'group', 'groups')}`
    return `Resize ${pluralEn(n, 'item', 'items')}`
  },
  /** History entry of a rotation with the canvas handles. */
  historyRotate: (n: number, kind: MovedKind) => {
    if (n === 1) return kind === 'group' ? 'Rotate group' : 'Rotate layer'
    if (kind === 'layer') return `Rotate ${pluralEn(n, 'layer', 'layers')}`
    if (kind === 'group') return `Rotate ${pluralEn(n, 'group', 'groups')}`
    return `Rotate ${pluralEn(n, 'item', 'items')}`
  },
  /** History entry of an Alt-drag (copies moved, originals stay). */
  historyDuplicate: (n: number, kind: MovedKind) => {
    if (n === 1) return kind === 'group' ? 'Duplicate group' : 'Duplicate layer'
    if (kind === 'layer') return `Duplicate ${pluralEn(n, 'layer', 'layers')}`
    if (kind === 'group') return `Duplicate ${pluralEn(n, 'group', 'groups')}`
    return `Duplicate ${pluralEn(n, 'item', 'items')}`
  },
}

export default viewport
