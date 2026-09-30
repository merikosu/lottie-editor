/**
 * Content of the keyboard shortcuts sheet: every registered command that has a shortcut
 * (hidden ones included — the sheet is where they are discovered), grouped like the palette,
 * plus mouse gestures. Search matches command names (in every UI language), keywords and the
 * keys themselves ("F9", "shift", "cmd z").
 */
import type { Command } from '@/commands/registry'
import { keyLabel, parseShortcut } from '@/commands/shortcuts'
import type { Dict } from '@/i18n'
import { GROUP_ORDER, groupOf, type GroupId } from '../groups'
import { commandFields, sharedKeywords } from '../palette/candidates'
import { fold } from '../search/fuzzy'
import { prepareQuery, rankItems, type SearchField } from '../search/rank'
import { GESTURE_GROUPS, modifierSearchText, type Gesture, type GestureGroupId } from './gestures'

export interface CommandSheetRow {
  kind: 'command'
  id: string
  title: string
  shortcuts: string[]
  fields: SearchField[]
}

export interface GestureSheetRow {
  kind: 'gesture'
  id: string
  title: string
  gesture: Gesture
  fields: SearchField[]
}

export type SheetRow = CommandSheetRow | GestureSheetRow

export type SheetGroupId = GroupId | `gestures-${GestureGroupId}`

export interface SheetGroup {
  id: SheetGroupId
  title: string
  rows: SheetRow[]
}

const WEIGHT_KEYS = 0.8
const WEIGHT_GROUP = 0.4

function shortcutsOf(cmd: Command): string[] {
  if (!cmd.shortcut) return []
  return (Array.isArray(cmd.shortcut) ? cmd.shortcut : [cmd.shortcut]).filter(
    (s) => parseShortcut(s) !== null,
  )
}

/** Searchable words for a shortcut: "mod+shift+z" → "⌘ cmd command ⇧ shift z". */
export function shortcutSearchText(shortcut: string, mac: boolean): string {
  const s = parseShortcut(shortcut)
  if (!s) return shortcut
  const parts: string[] = []
  if (s.mod) parts.push(modifierSearchText('mod', mac))
  if (s.ctrl) parts.push('⌃ ctrl control')
  if (s.alt) parts.push(modifierSearchText('alt', mac))
  if (s.shift) parts.push(modifierSearchText('shift', mac))
  parts.push(s.key.toLowerCase())
  // The key as shown too, when it is translated (Space → "Пробел").
  const label = keyLabel(s).toLowerCase()
  if (label !== s.key.toLowerCase()) parts.push(label)
  return parts.join(' ')
}

function commandTitle(cmd: Command, t: Dict): string {
  try {
    return cmd.title(t)
  } catch {
    return cmd.id
  }
}

export function buildSheet(commands: Iterable<Command>, t: Dict, mac: boolean): SheetGroup[] {
  const byGroup = new Map<GroupId, CommandSheetRow[]>()
  const list = [...commands]
  const shared = sharedKeywords(list)
  for (const cmd of list) {
    const shortcuts = shortcutsOf(cmd)
    if (!shortcuts.length) continue
    const title = commandTitle(cmd, t)
    const group = groupOf(cmd)
    const fields = commandFields(cmd, title, t, t.workspace.groups[group], shared)
    for (const sc of shortcuts)
      fields.push({ text: shortcutSearchText(sc, mac), weight: WEIGHT_KEYS })
    const rows = byGroup.get(group) ?? []
    rows.push({ kind: 'command', id: cmd.id, title, shortcuts, fields })
    byGroup.set(group, rows)
  }
  const groups: SheetGroup[] = []
  for (const id of GROUP_ORDER) {
    const rows = byGroup.get(id)
    if (rows?.length) groups.push({ id, title: t.workspace.groups[id], rows })
  }
  const s = t.workspace.shortcuts
  for (const gestureGroup of GESTURE_GROUPS) {
    const groupTitle = s.gestureGroups[gestureGroup.id]
    groups.push({
      id: `gestures-${gestureGroup.id}`,
      title: groupTitle,
      rows: gestureGroup.gestures.map((gesture) => {
        const title = s.gesture[gesture.id]
        const keys = gesture.combos
          .map((c) =>
            [...c.keys.map((k) => modifierSearchText(k, mac)), s.actions[c.action]].join(' '),
          )
          .join(' ')
        return {
          kind: 'gesture',
          id: gesture.id,
          title,
          gesture,
          fields: [
            { text: title, weight: 1 },
            { text: keys, weight: WEIGHT_KEYS },
            { text: groupTitle, weight: WEIGHT_GROUP },
            { text: s.gestures, weight: WEIGHT_GROUP },
          ],
        }
      }),
    })
  }
  return groups
}

export interface FilteredGroup {
  id: SheetGroupId
  title: string
  /** Matching rows with the matched characters of their titles (for highlighting). */
  rows: { row: SheetRow; positions: number[] }[]
}

/**
 * Rows far weaker than the best match are left out: with a strong match on screen, letters
 * scattered through a long title ("redo" in "REorDer layers Or…") are noise.
 */
const MIN_SCORE_RATIO = 0.5

const unfiltered = (group: SheetGroup): FilteredGroup => ({
  id: group.id,
  title: group.title,
  rows: group.rows.map((row) => ({ row, positions: [] })),
})

/**
 * Rows matching the query, groups kept in order (rows in each group by relevance). An empty
 * query keeps everything; a query that names a section ("go to", "playback") shows all of it.
 */
export function filterSheet(groups: readonly SheetGroup[], query: string): FilteredGroup[] {
  const q = prepareQuery(query)
  if (!q) return groups.map(unfiltered)
  const ranked = groups.map((group) => ({
    group,
    named: fold(group.title) === q.phrase,
    matches: rankItems(group.rows, (r) => r.fields, q),
  }))
  const top = Math.max(0, ...ranked.map(({ matches }) => matches[0]?.score ?? 0))
  const out: FilteredGroup[] = []
  for (const { group, named, matches } of ranked) {
    if (named) {
      out.push(unfiltered(group))
      continue
    }
    const rows = matches
      .filter((m) => m.score >= top * MIN_SCORE_RATIO)
      .map((m) => ({ row: m.item, positions: m.positions }))
    if (rows.length) out.push({ id: group.id, title: group.title, rows })
  }
  return out
}
