/**
 * What the command palette shows for a query.
 *
 * - Empty query ("browse"): recently used commands, then the commands that run on the current
 *   page, by section (see placement.ts). Disabled commands are left out: the list is for doing
 *   things now.
 * - Typed query: value actions first ("Go to frame 42"), then one ranked list of commands
 *   (available ones first; unavailable ones dimmed, with the reason when known) and matching
 *   layers. Commands and layers are ordered by their best match. Results that run on another
 *   page carry that page (`destination`); choosing them opens it first.
 */
import type { Route } from '@/app/router'
import type { Dict } from '@/i18n'
import { prepareQuery, rankItems } from '../search/rank'
import type { CommandCandidate } from './candidates'
import type { LayerEntry } from './layer-index'
import {
  IN_EDITOR,
  ON_DOCUMENT_PAGES,
  browseOrder,
  destinationFor,
  isOffered,
  listedWhenBrowsing,
  type Placement,
} from './placement'
import type { FrameAction, QuickAction, SpeedAction } from './quick-actions'

/** Page opened before the row's action runs; null when it runs on the current page. */
type Destination = Route | null

export type PaletteRow =
  | {
      type: 'command'
      value: string
      command: CommandCandidate
      positions: number[]
      showGroup: boolean
      destination: Destination
      /** Can be chosen (see `isOffered`); unavailable rows are dimmed, with the reason if known. */
      available: boolean
    }
  | {
      type: 'layer'
      value: string
      layer: LayerEntry
      positions: number[]
      destination: Destination
    }
  | { type: 'frame'; value: string; action: FrameAction; destination: Destination }
  | { type: 'speed'; value: string; action: SpeedAction; destination: Destination }

type CommandRow = Extract<PaletteRow, { type: 'command' }>

export interface PaletteSection {
  id: string
  heading?: string
  rows: PaletteRow[]
  /** Matches that were not listed (layers are capped). */
  more?: number
}

export interface SectionsInput {
  query: string
  commands: readonly CommandCandidate[]
  /** Null when no document is open. */
  layers: readonly LayerEntry[] | null
  /** Recently run command ids, newest first. */
  recent: readonly string[]
  quick: readonly QuickAction[]
  t: Dict
  /** The page the palette is open on (default: the editor). */
  route?: Route
}

/** Where layer results run: selecting one shows it in the editor's layer tree and timeline. */
export const LAYER_PLACEMENT: Placement = IN_EDITOR
/** Where frame and speed results run: pages with the animation's preview and transport. */
export const PLAYHEAD_PLACEMENT: Placement = ON_DOCUMENT_PAGES

export const RECENT_LIMIT = 5
export const LAYER_LIMIT = 8
/** Recently used commands rank a little higher when searching (most recent the most). */
const RECENT_BOOST = 1.5
/** Commands that work on the current page rank a little above equal matches that open another. */
const HERE_BOOST = 1
/**
 * Unavailable commands are listed only when they match about as well as the best result:
 * they cannot be run, so weak fuzzy matches of them are just noise.
 */
const UNAVAILABLE_MIN_RATIO = 0.6
/**
 * Available commands that match far worse than the best result are dropped too: a few letters
 * scattered through a long title ("undo" in cUstom backgrouND cOlor) are not what was meant.
 * Same ratio as the shortcuts sheet.
 */
const AVAILABLE_MIN_RATIO = 0.5

function commandRow(
  command: CommandCandidate,
  positions: number[],
  showGroup: boolean,
  destination: Destination,
  prefix = 'cmd',
): CommandRow {
  const available = isOffered(command, destination)
  return {
    type: 'command',
    value: `${prefix}:${command.id}`,
    command,
    positions,
    showGroup,
    destination,
    available,
  }
}

function browse(input: SectionsInput, route: Route): PaletteSection[] {
  const { recent, t } = input
  const hasDocument = input.layers !== null
  // Everything offered here runs here, so browse rows never have a destination. "Go to" leaves
  // out the page that is already open (the service commands are `app.<route>`).
  const here = `app.${route}`
  const runnable = input.commands.filter(
    (c) => c.enabled && c.id !== here && listedWhenBrowsing(c.placement, route, hasDocument),
  )
  const byId = new Map(runnable.map((c) => [c.id, c]))
  const recentRows: PaletteRow[] = []
  const shown = new Set<string>()
  for (const id of recent) {
    const cmd = byId.get(id)
    if (!cmd || shown.has(id)) continue
    shown.add(id)
    recentRows.push(commandRow(cmd, [], false, null, 'recent'))
    if (recentRows.length >= RECENT_LIMIT) break
  }
  const sections: PaletteSection[] = []
  if (recentRows.length)
    sections.push({ id: 'recent', heading: t.workspace.palette.recent, rows: recentRows })
  for (const group of browseOrder(route, hasDocument)) {
    const rows = runnable
      .filter((c) => c.group === group && !shown.has(c.id))
      .map((c) => commandRow(c, [], false, null))
    if (rows.length)
      sections.push({ id: `group:${group}`, heading: t.workspace.groups[group], rows })
  }
  return sections
}

function quickRows(quick: readonly QuickAction[], route: Route): PaletteRow[] {
  const destination = destinationFor(PLAYHEAD_PLACEMENT, route)
  return quick.map((action) =>
    action.kind === 'frame'
      ? { type: 'frame', value: `frame:${action.frame}`, action, destination }
      : { type: 'speed', value: `speed:${action.speed}`, action, destination },
  )
}

function search(
  input: SectionsInput,
  route: Route,
  query: NonNullable<ReturnType<typeof prepareQuery>>,
): PaletteSection[] {
  const { commands, layers, recent, t } = input
  const recentRank = new Map(recent.map((id, i) => [id, i]))
  const boost = (c: CommandCandidate) => {
    const i = recentRank.get(c.id)
    const recency = i === undefined ? 0 : RECENT_BOOST * (1 - i / Math.max(recent.length, 1))
    return recency + (destinationFor(c.placement, route) === null ? HERE_BOOST : 0)
  }
  const ranked = rankItems(commands, (c) => c.fields, query, boost).map((r) => ({
    ...r,
    row: commandRow(r.item, r.positions, true, destinationFor(r.item.placement, route)),
  }))
  const topScore = ranked[0]?.score ?? 0
  const available = ranked.filter(
    (r) => r.row.available && r.score >= topScore * AVAILABLE_MIN_RATIO,
  )
  const unavailable = ranked.filter(
    (r) => !r.row.available && r.score >= topScore * UNAVAILABLE_MIN_RATIO,
  )
  const commandRows = [...available, ...unavailable].map((r) => r.row)

  const layerDestination = destinationFor(LAYER_PLACEMENT, route)
  const layerMatches = layers ? rankItems(layers, (l) => l.fields, query) : []
  const layerRows: PaletteRow[] = layerMatches.slice(0, LAYER_LIMIT).map((r) => ({
    type: 'layer',
    value: `layer:${r.item.key}`,
    layer: r.item,
    positions: r.positions,
    destination: layerDestination,
  }))

  const sections: PaletteSection[] = []
  const quick = quickRows(input.quick, route)
  if (quick.length) sections.push({ id: 'quick', rows: quick })

  const commandSection: PaletteSection | null = commandRows.length
    ? { id: 'commands', heading: t.workspace.palette.results, rows: commandRows }
    : null
  const layerSection: PaletteSection | null = layerRows.length
    ? {
        id: 'layers',
        heading: t.workspace.palette.layers,
        rows: layerRows,
        more: Math.max(0, layerMatches.length - LAYER_LIMIT) || undefined,
      }
    : null
  const bestCommand = available[0]?.score ?? -Infinity
  const bestLayer = layerMatches[0]?.score ?? -Infinity
  const ordered =
    bestLayer > bestCommand ? [layerSection, commandSection] : [commandSection, layerSection]
  for (const s of ordered) if (s) sections.push(s)
  return sections
}

export function buildSections(input: SectionsInput): PaletteSection[] {
  const route = input.route ?? 'edit'
  const query = prepareQuery(input.query)
  return query ? search(input, route, query) : browse(input, route)
}
