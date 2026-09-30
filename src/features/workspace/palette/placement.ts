/**
 * Where palette actions happen.
 *
 * The palette works on every page (home, editor, customize, optimizer), but many commands only
 * make sense where their UI is: zooming needs the editor's canvas, a customize command its page.
 * Every command therefore has the pages where it runs in place; chosen anywhere else, the
 * palette opens the first of those pages and runs it there, so an action always has a visible
 * result.
 *
 * Browsing (empty query) lists only what runs on the current page, the page's own commands
 * first; searching finds everything, and results that open another page say so.
 */
import type { Route } from '@/app/router'
import { GROUP_ORDER, type GroupId } from '../groups'

export interface Placement {
  /** Pages where the action runs in place; null: any page. */
  routes: readonly Route[] | null
  /**
   * The action is about the open animation, so it is only offered for browsing while one is
   * open (without one, its page shows a start screen instead).
   */
  document: boolean
}

export const ANYWHERE: Placement = { routes: null, document: false }
/** The editor's panels, canvas and timeline. */
export const IN_EDITOR: Placement = { routes: ['edit'], document: true }
/** Pages that show the open animation: document edits and playback are visible there. */
export const ON_DOCUMENT_PAGES: Placement = { routes: ['edit', 'customize'], document: true }
const ON_CUSTOMIZE: Placement = { routes: ['customize'], document: false }
const ON_OPTIMIZER: Placement = { routes: ['optimize'], document: false }

/**
 * Commands whose result shows only in the editor, although their section suggests otherwise:
 * they open an editor panel, or add a marker (drawn only by the timeline).
 */
const EDITOR_ONLY_COMMANDS = new Set([
  'anim.colors',
  'anim.settings',
  'anim.issues',
  'anim.addMarker',
  'assets.show',
])
/** Commands that switch pages themselves (e.g. sending the animation to the optimizer). */
const SELF_NAVIGATING = new Set(['anim.optimize'])
/** Preferences and actions that are not tied to a page. */
const GLOBAL_IDS = /^(?:view\.(?:theme|language)\.|edit\.paste$)/
/**
 * File commands about the open animation (saving, exporting, reverting), as opposed to opening
 * files, which every page handles in its own way (io and the optimizer decide).
 */
const DOCUMENT_FILE_COMMANDS =
  /^(?:export\.|assets\.|file\.(?:download|export|revert|switchAnimation|importAsLayer)$)/
/**
 * Commands that are disabled only while their page is not on screen: zooming needs the mounted
 * canvas or timeline (their `enabled()` checks exactly that). Anything else that is disabled
 * stays disabled after a page switch too (no selection, no changes), so it is not offered.
 */
const NEEDS_PAGE_UI = /^(?:view|timeline)\.zoom/

/** Where a command runs, from its id and palette section. */
export function commandPlacement(id: string, group: GroupId): Placement {
  if (EDITOR_ONLY_COMMANDS.has(id)) return IN_EDITOR
  if (DOCUMENT_FILE_COMMANDS.test(id)) return ON_DOCUMENT_PAGES
  if (group === 'services' || group === 'help' || group === 'file') return ANYWHERE
  if (GLOBAL_IDS.test(id) || SELF_NAVIGATING.has(id)) return ANYWHERE
  if (group === 'customize') return ON_CUSTOMIZE
  if (group === 'optimizer') return ON_OPTIMIZER
  if (id === 'edit.undo' || id === 'edit.redo' || group === 'playback') return ON_DOCUMENT_PAGES
  if (group === 'animation') return ON_DOCUMENT_PAGES
  return IN_EDITOR
}

/** The page to open before running an action placed at `placement`, or null to run it here. */
export function destinationFor(placement: Placement, route: Route): Route | null {
  if (!placement.routes || placement.routes.includes(route)) return null
  return placement.routes[0] ?? null
}

/**
 * Whether a command can be chosen: it is enabled, or it runs on another page and is disabled
 * only because that page is not open (`reason` is the known reason it is disabled, if any).
 */
export function isOffered(
  cmd: { id: string; enabled: boolean; reason?: string },
  destination: Route | null,
): boolean {
  return (
    cmd.enabled || (destination !== null && cmd.reason === undefined && NEEDS_PAGE_UI.test(cmd.id))
  )
}

/** True when browsing on `route` should list an action placed at `placement`. */
export function listedWhenBrowsing(
  placement: Placement,
  route: Route,
  hasDocument: boolean,
): boolean {
  if (!placement.routes) return true
  return placement.routes.includes(route) && (hasDocument || !placement.document)
}

/**
 * Sections listed when browsing, in order. The editor lists all of its sections; the other
 * pages lead with their own commands and list only sections that do something there (playback
 * is left out on Customize: the page has its own transport, and search still finds it).
 */
export function browseOrder(route: Route, hasDocument: boolean): readonly GroupId[] {
  switch (route) {
    case 'edit':
      return hasDocument ? GROUP_ORDER : ['file', 'edit', 'services', 'view', 'help']
    case 'customize':
      return ['customize', 'file', 'edit', 'animation', 'services', 'view', 'help']
    case 'optimize':
      return ['optimizer', 'file', 'edit', 'services', 'view', 'help']
    case 'home':
      return ['services', 'file', 'edit', 'view', 'help']
  }
}
