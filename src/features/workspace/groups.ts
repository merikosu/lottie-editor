/**
 * Sections of the command palette and the shortcuts sheet. Command categories map 1:1 to
 * sections, with a few id-based exceptions:
 *  - keyframe and JSON-editor commands get their own sections, so the long "Edit" list stays
 *    readable;
 *  - service switching (`app.*`, registered by the shell under "View") is "Go to";
 *  - commands of the Customize and Optimizer pages (`customize.*`, `optimizer.*`) are listed
 *    under their service, whatever category they declare.
 */
import type { Command, CommandCategory } from '@/commands/registry'
import type { Dict } from '@/i18n'

export type GroupId =
  CommandCategory | 'keyframes' | 'code' | 'customize' | 'optimizer' | 'services'

export const GROUP_ORDER: readonly GroupId[] = [
  'file',
  'edit',
  'view',
  'animation',
  'layer',
  'keyframes',
  'playback',
  'code',
  'customize',
  'optimizer',
  'services',
  'help',
]

/** Id prefixes that decide the section before the declared category does. */
const PREFIX_GROUPS: readonly (readonly [string, GroupId])[] = [
  ['app.', 'services'],
  ['keyframes.', 'keyframes'],
  ['code.', 'code'],
  ['customize.', 'customize'],
  ['optimizer.', 'optimizer'],
]

export function groupOf(cmd: Pick<Command, 'id' | 'category'>): GroupId {
  for (const [prefix, group] of PREFIX_GROUPS) if (cmd.id.startsWith(prefix)) return group
  return cmd.category
}

export function groupLabel(group: GroupId, t: Dict): string {
  return t.workspace.groups[group]
}

/** Sort key of a group (unknown groups last). */
export function groupRank(group: GroupId): number {
  const i = GROUP_ORDER.indexOf(group)
  return i < 0 ? GROUP_ORDER.length : i
}
