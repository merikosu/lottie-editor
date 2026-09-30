import { describe, expect, it } from 'vitest'
import type { Command } from '@/commands/registry'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import { GESTURE_GROUPS, modifierLabel } from '../gestures'
import {
  buildSheet,
  filterSheet,
  shortcutSearchText,
  type FilteredGroup,
  type SheetGroup,
} from '../sheet'

const noop = () => {}
const cmd = (
  id: string,
  category: Command['category'],
  title: string,
  extra: Partial<Command> = {},
): Command => ({
  id,
  category,
  title: () => title,
  run: noop,
  ...extra,
})

const COMMANDS: Command[] = [
  cmd('edit.undo', 'edit', 'Undo', { shortcut: 'mod+z' }),
  cmd('edit.redo', 'edit', 'Redo', { shortcut: ['mod+shift+z', 'mod+y'] }),
  cmd('edit.history', 'edit', 'History'),
  cmd('keyframes.easyEase', 'edit', 'Easy ease', { shortcut: 'f9' }),
  cmd('keyframes.nudgeLeft10', 'edit', 'Nudge keyframes left 10 frames', {
    shortcut: 'alt+shift+,',
    hidden: true,
  }),
  cmd('code.format', 'edit', 'Format JSON', { shortcut: 'shift+alt+f' }),
  cmd('file.open', 'file', 'Open…', { shortcut: 'mod+o' }),
  cmd('playback.toggle', 'playback', 'Play / Pause', { shortcut: 'space' }),
  cmd('help.commandPalette', 'help', 'Command palette…', {
    shortcut: ['mod+k', 'mod+shift+p'],
    hidden: true,
  }),
  cmd('broken.shortcut', 'view', 'Broken', { shortcut: 'mod+nope' }),
  cmd('app.home', 'view', 'Home'),
  cmd('app.optimize', 'view', 'Optimizer', { shortcut: 'alt+3' }),
  cmd('app.edit', 'view', 'Editor', { shortcut: 'alt+1' }),
]

const ids = (groups: SheetGroup[]) => groups.map((g) => [g.id, g.rows.map((r) => r.id)])
const filteredIds = (groups: FilteredGroup[]) =>
  groups.map((g) => [g.id, g.rows.map((r) => r.row.id)])
const filteredRowIds = (groups: FilteredGroup[]) =>
  groups.flatMap((g) => g.rows.map((r) => r.row.id))

describe('buildSheet', () => {
  const sheet = buildSheet(COMMANDS, en, true)

  it('groups commands with shortcuts in palette order, gestures last', () => {
    expect(ids(sheet).map(([id]) => id)).toEqual([
      'file',
      'edit',
      'keyframes',
      'playback',
      'code',
      'services',
      'help',
      'gestures-canvas',
      'gestures-timeline',
    ])
  })

  it('lists service switching under "Go to", in registration order', () => {
    const services = sheet.find((g) => g.id === 'services')!
    expect(services.title).toBe('Go to')
    expect(services.rows.map((r) => r.id)).toEqual(['app.optimize', 'app.edit'])
  })

  it('includes hidden commands and every alternate shortcut', () => {
    const edit = sheet.find((g) => g.id === 'edit')!
    expect(edit.rows.map((r) => r.id)).toEqual(['edit.undo', 'edit.redo'])
    const redo = edit.rows[1]
    expect(redo.kind === 'command' && redo.shortcuts).toEqual(['mod+shift+z', 'mod+y'])
    expect(sheet.find((g) => g.id === 'help')!.rows[0].id).toBe('help.commandPalette')
    expect(sheet.find((g) => g.id === 'keyframes')!.rows.map((r) => r.id)).toContain(
      'keyframes.nudgeLeft10',
    )
  })

  it('skips commands without a valid shortcut', () => {
    const all = sheet.flatMap((g) => g.rows.map((r) => r.id))
    expect(all).not.toContain('edit.history')
    expect(all).not.toContain('broken.shortcut')
  })

  it('lists every gesture of both groups', () => {
    const [canvas, timeline] = GESTURE_GROUPS
    expect(sheet.at(-2)!.rows.map((r) => r.id)).toEqual(canvas.gestures.map((g) => g.id))
    expect(sheet.at(-1)!.rows.map((r) => r.id)).toEqual(timeline.gestures.map((g) => g.id))
  })

  it('translates titles', () => {
    const ruSheet = buildSheet(COMMANDS, ru, false)
    expect(ruSheet[0].title).toBe('Файл')
    expect(ruSheet.at(-2)!.title).toBe('Холст: мышь и трекпад')
    expect(ruSheet.at(-1)!.title).toBe('Таймлайн и слои: мышь')
  })
})

describe('filterSheet', () => {
  const sheet = buildSheet(COMMANDS, en, true)

  it('returns everything for an empty query', () => {
    expect(filteredIds(filterSheet(sheet, '  '))).toEqual(ids(sheet))
  })

  it('finds commands by name and marks the matched characters', () => {
    const found = filterSheet(sheet, 'redo')
    expect(filteredIds(found)).toEqual([['edit', ['edit.redo']]])
    expect(found[0].rows[0].positions).toEqual([0, 1, 2, 3])
  })

  it('finds commands by key', () => {
    expect(filteredIds(filterSheet(sheet, 'f9'))).toEqual([['keyframes', ['keyframes.easyEase']]])
    const shift = filteredRowIds(filterSheet(sheet, 'shift'))
    expect(shift).toEqual(
      expect.arrayContaining(['edit.redo', 'keyframes.nudgeLeft10', 'code.format']),
    )
    expect(shift).not.toContain('edit.undo')
  })

  it('finds modifier names on macOS', () => {
    expect(filteredRowIds(filterSheet(sheet, 'cmd k'))[0]).toBe('help.commandPalette')
  })

  it('finds gestures by action words', () => {
    expect(filteredRowIds(filterSheet(sheet, 'pinch'))).toEqual(['zoomCanvas', 'zoomTimeline'])
  })

  it('shows a whole section when the query names it', () => {
    const found = filterSheet(sheet, 'Go To ')
    expect(found.find((g) => g.id === 'services')?.rows.map((r) => r.row.id)).toEqual([
      'app.optimize',
      'app.edit',
    ])
    const ruSheet = buildSheet(COMMANDS, ru, false)
    expect(filterSheet(ruSheet, 'переход').map((g) => g.id)).toEqual(['services'])
  })

  it('finds gestures by the name of their group', () => {
    const found = filterSheet(sheet, 'trackpad')
    expect(found.map((g) => g.id)).toEqual(['gestures-canvas'])
    expect(filteredRowIds(filterSheet(sheet, 'gestures')).length).toBeGreaterThan(20)
  })

  it('finds a modifier used by gestures', () => {
    const alt = filteredRowIds(filterSheet(sheet, 'option drag'))
    expect(alt).toEqual(['duplicateKeys'])
  })

  it('returns no groups when nothing matches', () => {
    expect(filterSheet(sheet, 'qqqzzz')).toEqual([])
  })
})

describe('shortcut labels', () => {
  it('describes shortcuts in searchable words', () => {
    expect(shortcutSearchText('mod+shift+z', true)).toBe('⌘ cmd command ⇧ shift z')
    expect(shortcutSearchText('mod+shift+z', false)).toBe('ctrl control ⇧ shift z')
    expect(shortcutSearchText('alt+x', true)).toBe('⌥ alt option opt x')
    expect(shortcutSearchText('mod+nope', true)).toBe('mod+nope')
  })

  it('labels modifiers per platform', () => {
    expect(modifierLabel('mod', true)).toBe('⌘')
    expect(modifierLabel('mod', false)).toBe('Ctrl')
    expect(modifierLabel('alt', false)).toBe('Alt')
    expect(modifierLabel('space', true)).toBe('Space')
  })
})
