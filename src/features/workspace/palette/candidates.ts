/**
 * Command palette entries built from the command registry: display data (title, icon,
 * shortcut, toggle state, why it is disabled) plus the fields the search matches against.
 */
import type { ComponentType } from 'react'
import {
  isCommandEnabled,
  primaryShortcut,
  type Command,
  type IconProps,
} from '@/commands/registry'
import { loadedDictionaries, type Dict } from '@/i18n'
import { groupLabel, groupOf, type GroupId } from '../groups'
import { EXACT_SYNONYM_WEIGHT, type SearchField } from '../search/rank'
import { commandPlacement, type Placement } from './placement'
import { disabledReason, type ReasonContext } from './reasons'
import { SYNONYMS } from './synonyms'

export interface CommandCandidate {
  id: string
  title: string
  group: GroupId
  groupLabel: string
  icon?: ComponentType<IconProps>
  shortcut?: string
  enabled: boolean
  /** Toggle state (undefined for plain actions). */
  checked?: boolean
  /** Why the command is disabled, when it can be told. */
  reason?: string
  /** One line about what the command opens (services). */
  hint?: string
  /** Pages where it runs (see placement.ts). */
  placement: Placement
  /** Search fields; the first one is the visible title. */
  fields: SearchField[]
}

// Titles in every loaded UI language are searchable ("undo" in the Russian UI); the palette
// loads all languages when it opens (see CommandPalette).

const WEIGHT_OTHER_LANGUAGE = 0.9
const WEIGHT_KEYWORD = 0.75
const WEIGHT_GROUP = 0.4
/**
 * A keyword that many commands list (every color command says "palette" and "theme") tells
 * little about any one of them: it counts less than the palette's own synonyms (synonyms.ts,
 * chosen per command), so "тема" finds the theme switch before the color tools.
 */
const SHARED_KEYWORD_COMMANDS = 3
const SHARED_KEYWORD_FACTOR = 0.8
const SHARED_EXACT_WEIGHT = EXACT_SYNONYM_WEIGHT * SHARED_KEYWORD_FACTOR

const normalize = (word: string) => word.trim().toLowerCase()

/** Keywords the commands declare, listed by at least SHARED_KEYWORD_COMMANDS of them. */
export function sharedKeywords(commands: Iterable<Command>): Set<string> {
  const counts = new Map<string, number>()
  for (const cmd of commands) {
    for (const word of new Set((cmd.keywords ?? []).map(normalize)))
      counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, n]) => n >= SHARED_KEYWORD_COMMANDS).map(([w]) => w))
}

/** What each page is for, shown next to the "Go to" commands. */
const HINTS: Readonly<Record<string, (t: Dict) => string>> = {
  'app.home': (t) => t.workspace.palette.homeHint,
  'app.edit': (t) => t.app.services.editHint,
  'app.customize': (t) => t.app.services.customizeHint,
  'app.optimize': (t) => t.app.services.optimizeHint,
}

function safeTitle(cmd: Command, t: Dict): string {
  try {
    return cmd.title(t)
  } catch {
    return cmd.id
  }
}

function safeChecked(cmd: Command): boolean | undefined {
  if (!cmd.checked) return undefined
  try {
    return cmd.checked()
  } catch {
    return undefined
  }
}

/**
 * Search fields of a command: title, titles in other languages, keywords, section name.
 * `shared` lists keywords too common to say much (see sharedKeywords).
 */
export function commandFields(
  cmd: Command,
  title: string,
  t: Dict,
  group: string,
  shared: ReadonlySet<string> = new Set(),
): SearchField[] {
  const fields: SearchField[] = [{ text: title, weight: 1 }]
  const seen = new Set([title.toLowerCase()])
  const add = (text: string, weight: number, exactWeight?: number) => {
    const key = normalize(text)
    if (!key || seen.has(key)) return
    seen.add(key)
    fields.push(exactWeight === undefined ? { text, weight } : { text, weight, exactWeight })
  }
  for (const dict of loadedDictionaries())
    if (dict !== t) add(safeTitle(cmd, dict), WEIGHT_OTHER_LANGUAGE)
  // Synonyms first: when a command also declares one of them as a keyword, it keeps full weight.
  for (const word of SYNONYMS[cmd.id] ?? []) add(word, WEIGHT_KEYWORD)
  for (const word of cmd.keywords ?? []) {
    if (shared.has(normalize(word)))
      add(word, WEIGHT_KEYWORD * SHARED_KEYWORD_FACTOR, SHARED_EXACT_WEIGHT)
    else add(word, WEIGHT_KEYWORD)
  }
  add(group, WEIGHT_GROUP)
  return fields
}

/**
 * Palette entries for the registered commands (hidden ones excluded), in registration order.
 * `enabled()` / `checked()` are evaluated once here, when the palette opens.
 */
export function buildCandidates(
  commands: Iterable<Command>,
  t: Dict,
  ctx: ReasonContext,
): CommandCandidate[] {
  const list = [...commands]
  const shared = sharedKeywords(list)
  const out: CommandCandidate[] = []
  for (const cmd of list) {
    if (cmd.hidden) continue
    const title = safeTitle(cmd, t)
    const group = groupOf(cmd)
    const label = groupLabel(group, t)
    const enabled = isCommandEnabled(cmd)
    out.push({
      id: cmd.id,
      title,
      group,
      groupLabel: label,
      icon: cmd.icon,
      shortcut: primaryShortcut(cmd),
      enabled,
      checked: safeChecked(cmd),
      reason: enabled ? undefined : disabledReason(cmd, ctx, t),
      hint: HINTS[cmd.id]?.(t),
      placement: commandPlacement(cmd.id, group),
      fields: commandFields(cmd, title, t, label, shared),
    })
  }
  return out
}
