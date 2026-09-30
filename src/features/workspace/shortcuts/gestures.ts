/**
 * Mouse and trackpad gestures for the shortcuts sheet, in two groups: the canvas, and the
 * timeline with the layer list. Each one is implemented by the viewport pane (pane.ts,
 * move-gesture.ts), the timeline controller or the layer tree (checked against their pointer
 * handlers); keep this list in sync when those change.
 */
import { getT, type Dict } from '@/i18n'

export type Modifier = 'mod' | 'shift' | 'alt' | 'space'
type Strings = Dict['workspace']['shortcuts']
export type GestureAction = keyof Strings['actions']
export type GestureGroupId = keyof Strings['gestureGroups']

/** One way to perform a gesture: modifier keys held + a pointer action. */
export interface GestureCombo {
  keys: Modifier[]
  action: GestureAction
}

export interface Gesture {
  id: keyof Strings['gesture']
  /** Alternatives, shown with "or". */
  combos: GestureCombo[]
}

export interface GestureGroup {
  id: GestureGroupId
  gestures: readonly Gesture[]
}

const combo = (action: GestureAction, ...keys: Modifier[]): GestureCombo => ({ keys, action })

export const GESTURE_GROUPS: readonly GestureGroup[] = [
  {
    id: 'canvas',
    gestures: [
      { id: 'panCanvas', combos: [combo('drag', 'space'), combo('middleDrag'), combo('scroll')] },
      { id: 'zoomCanvas', combos: [combo('scroll', 'mod'), combo('pinch')] },
      { id: 'scrollSideways', combos: [combo('scroll', 'shift')] },
      { id: 'playPauseCanvas', combos: [combo('tap', 'space')] },
      { id: 'deepSelect', combos: [combo('click', 'mod')] },
      { id: 'addToSelection', combos: [combo('click', 'shift')] },
      { id: 'marquee', combos: [combo('drag')] },
      { id: 'moveSelection', combos: [combo('drag')] },
      { id: 'constrainMove', combos: [combo('drag', 'shift')] },
      { id: 'freeMove', combos: [combo('drag', 'mod')] },
      { id: 'enterGroup', combos: [combo('doubleClick')] },
    ],
  },
  {
    id: 'timeline',
    gestures: [
      { id: 'zoomTimeline', combos: [combo('scroll', 'mod'), combo('pinch')] },
      { id: 'scrollTimeline', combos: [combo('scroll', 'shift')] },
      { id: 'scrubSnap', combos: [combo('drag', 'shift')] },
      { id: 'duplicateKeys', combos: [combo('drag', 'alt')] },
      { id: 'snapKeys', combos: [combo('drag', 'shift')] },
      { id: 'freeDrag', combos: [combo('drag', 'mod')] },
      { id: 'reorderLayers', combos: [combo('drag')] },
      { id: 'selectRange', combos: [combo('click', 'shift')] },
      { id: 'toggleSelection', combos: [combo('click', 'mod')] },
      { id: 'renameLayer', combos: [combo('doubleClick')] },
      { id: 'expandAll', combos: [combo('click', 'alt')] },
    ],
  },
]

/** Keycap label of a modifier on this platform. */
export function modifierLabel(key: Modifier, mac: boolean): string {
  switch (key) {
    case 'mod':
      return mac ? '⌘' : 'Ctrl'
    case 'shift':
      return mac ? '⇧' : 'Shift'
    case 'alt':
      return mac ? '⌥' : 'Alt'
    case 'space':
      return getT().common.keys.space
  }
}

/** Words a user might type to find a modifier ("cmd", "option", "ctrl", …). */
export function modifierSearchText(key: Modifier, mac: boolean): string {
  switch (key) {
    case 'mod':
      return mac ? '⌘ cmd command' : 'ctrl control'
    case 'shift':
      return '⇧ shift'
    case 'alt':
      return mac ? '⌥ alt option opt' : 'alt'
    case 'space':
      return 'space пробел'
  }
}
