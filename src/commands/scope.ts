/**
 * Where a command's shortcut may fire. Commands that act on the editor document (editing,
 * layers, keyframes, playback, timeline, canvas zoom, saving) only make sense on the pages that
 * show that document; elsewhere (home, optimizer) their keys stay free for the page.
 */
import type { Route } from '@/app/router'
import type { Command } from './registry'

const DOCUMENT_ROUTES: Route[] = ['edit', 'customize']
const EDITOR_ONLY: Route[] = ['edit']

const DOCUMENT_FILE_COMMANDS = new Set([
  'file.download',
  'file.export',
  'file.revert',
  'file.close',
  'file.switchAnimation',
  'file.importAsLayer',
])

/** Routes where the command's shortcut is active (null = everywhere). */
export function shortcutRoutes(cmd: Command): Route[] | null {
  if (cmd.routes) return cmd.routes
  const id = cmd.id
  if (id.startsWith('keyframes.') || id.startsWith('timeline.') || id.startsWith('code.'))
    return EDITOR_ONLY
  if (id.startsWith('view.zoom') || id === 'view.toggleBounds' || id === 'view.compare')
    return EDITOR_ONLY
  if (DOCUMENT_FILE_COMMANDS.has(id) || id.startsWith('export.')) return DOCUMENT_ROUTES
  if (
    cmd.category === 'edit' ||
    cmd.category === 'layer' ||
    cmd.category === 'playback' ||
    cmd.category === 'animation'
  ) {
    return DOCUMENT_ROUTES
  }
  return null
}
