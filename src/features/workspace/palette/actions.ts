/**
 * What choosing a palette row does. These run after the palette has closed. Actions placed on
 * other pages open their page first (see placement.ts); where to go is decided now, from the
 * current page, not from when the row was rendered.
 */
import { currentRoute } from '@/app/router'
import { runCommand } from '@/commands/registry'
import { emit } from '@/lib/events'
import type { NodePath } from '@/lottie/path'
import { selectNodes } from '@/store/document'
import { setFrame, setSpeed } from '@/store/playback'
import { setPrefs } from '@/store/prefs'
import { runOnRoute } from '../navigation'
import { destinationFor, type Placement } from './placement'
import { recordCommandUse } from './recent'
import { LAYER_PLACEMENT, PLAYHEAD_PLACEMENT, type PaletteRow } from './sections'

/** Runs `fn` where `placement` says, opening that page first when needed. */
function runPlaced(placement: Placement, fn: () => void): void {
  runOnRoute(destinationFor(placement, currentRoute()), fn)
}

/** Selects a layer and shows it in the layer tree and timeline (opening the editor if needed). */
export function revealLayer(path: NodePath): void {
  selectNodes([path])
  setPrefs({ leftTab: 'layers' })
  // The tree and timeline listen only while mounted, so reveal once the editor is on screen.
  runPlaced(LAYER_PLACEMENT, () => emit('reveal-node', { path }))
}

/** Performs a row's action (the palette is already closed). */
export function performRow(row: PaletteRow): void {
  switch (row.type) {
    case 'command': {
      const { id, placement } = row.command
      recordCommandUse(id)
      runPlaced(placement, () => runCommand(id))
      break
    }
    case 'layer':
      revealLayer(row.layer.path)
      break
    case 'frame': {
      const { frame } = row.action
      runPlaced(PLAYHEAD_PLACEMENT, () => setFrame(frame))
      break
    }
    case 'speed': {
      const { speed } = row.action
      runPlaced(PLAYHEAD_PLACEMENT, () => setSpeed(speed))
      break
    }
  }
}
