import { describe, expect, it } from 'vitest'
import type { Command } from '@/commands/registry'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import type { Dict } from '@/i18n'
import { buildCandidates } from '../candidates'
import { buildLayerIndex } from '../layer-index'
import { parseQuickActions } from '../quick-actions'
import { LAYER_LIMIT, buildSections, type PaletteRow, type PaletteSection } from '../sections'
import type { Route } from '@/app/router'
import type { Animation } from '@/lottie/types'

const noop = () => {}

function cmd(
  id: string,
  category: Command['category'],
  title: string,
  extra: Partial<Command> = {},
): Command {
  return { id, category, title: () => title, run: noop, ...extra }
}

/** A realistic slice of the registry (titles fixed, like a single-language build). */
const COMMANDS: Command[] = [
  cmd('file.open', 'file', 'Open…', { shortcut: 'mod+o', keywords: ['import'] }),
  cmd('file.download', 'file', 'Download', { shortcut: 'mod+s' }),
  cmd('file.export', 'file', 'Export…', { shortcut: 'mod+shift+e' }),
  cmd('edit.undo', 'edit', 'Undo', { shortcut: 'mod+z', enabled: () => false }),
  cmd('edit.redo', 'edit', 'Redo', { shortcut: 'mod+shift+z' }),
  cmd('edit.history', 'edit', 'History'),
  cmd('view.zoomIn', 'view', 'Zoom in', { shortcut: '=' }),
  cmd('view.zoomFit', 'view', 'Zoom to fit', { shortcut: 'shift+1' }),
  cmd('timeline.zoomIn', 'view', 'Zoom timeline in'),
  cmd('view.toggleTimeline', 'view', 'Toggle timeline', { checked: () => true }),
  cmd('view.theme.dark', 'view', 'Dark theme', { hidden: true }),
  cmd('anim.optimize', 'animation', 'Optimize…'),
  cmd('anim.trim', 'animation', 'Trim to work area', { enabled: () => false }),
  cmd('layer.rename', 'layer', 'Rename', { shortcut: 'f2', enabled: () => false }),
  cmd('keyframes.easyEase', 'edit', 'Easy ease', { shortcut: 'f9', enabled: () => false }),
  cmd('playback.toggle', 'playback', 'Play / Pause', { shortcut: 'space' }),
  cmd('playback.speed.2', 'playback', 'Speed 2×'),
  cmd('help.shortcuts', 'help', 'Keyboard shortcuts', { shortcut: '?' }),
  cmd('app.home', 'view', 'Home'),
  cmd('app.edit', 'view', 'Editor', { shortcut: 'alt+1' }),
  cmd('app.customize', 'view', 'Customize', { shortcut: 'alt+2' }),
  cmd('app.optimize', 'view', 'Optimizer', { shortcut: 'alt+3' }),
]

/** A command with a real title per language (like the app's dictionaries). */
const titled = (
  id: string,
  enTitle: string,
  ruTitle: string,
  category: Command['category'],
): Command => ({
  id,
  category,
  title: (t) => (t === ru ? ruTitle : enTitle),
  run: noop,
})

const ctx = { hasDocument: true, hasNodes: false, hasKeyframes: false, hasWorkArea: false }

const layer = (nm: string, ty = 4) => ({ nm, ty, ip: 0, op: 60, st: 0, ks: {} })

function doc(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
      layer('Ball'),
      layer('Shadow'),
      layer('Title', 5),
      { ...layer('Scene', 0), refId: 'comp_0' },
    ],
    assets: [
      { id: 'comp_0', nm: 'Background comp', layers: [layer('Sky'), layer('Ball highlight')] },
    ],
  } as unknown as Animation
}

function sections(
  query: string,
  opts: { t?: Dict; recent?: string[]; withDoc?: boolean; route?: Route; extra?: Command[] } = {},
): PaletteSection[] {
  const t = opts.t ?? en
  const d = opts.withDoc === false ? null : doc()
  return buildSections({
    query,
    commands: buildCandidates([...COMMANDS, ...(opts.extra ?? [])], t, {
      ...ctx,
      hasDocument: d !== null,
    }),
    layers: d ? buildLayerIndex(d, t) : null,
    recent: opts.recent ?? [],
    quick: parseQuickActions(query, d),
    t,
    route: opts.route,
  })
}

const headings = (s: PaletteSection[]) => s.map((x) => x.heading)
const commandRows = (s: PaletteSection[]) =>
  s
    .flatMap((x) => x.rows)
    .filter((r): r is Extract<PaletteRow, { type: 'command' }> => r.type === 'command')
const rowFor = (s: PaletteSection[], id: string) => commandRows(s).find((r) => r.command.id === id)

/** Titles found for a query among `list` (no document). */
const searchTitles = (query: string, list: Command[]) =>
  buildSections({
    query,
    commands: buildCandidates(list, en, ctx),
    layers: null,
    recent: [],
    quick: [],
    t: en,
  }).flatMap((x) => titles(x.rows))

const titles = (rows: PaletteRow[]) =>
  rows.map((r) =>
    r.type === 'command' ? r.command.title : r.type === 'layer' ? r.layer.name : r.type,
  )

describe('buildSections: browse', () => {
  it('lists available, visible commands by section in a fixed order', () => {
    const s = sections('')
    expect(s.map((x) => x.heading)).toEqual([
      'File',
      'Edit',
      'View',
      'Animation',
      'Playback',
      'Go to',
      'Help',
    ])
    const all = s.flatMap((x) => titles(x.rows))
    expect(all).not.toContain('Undo') // disabled
    expect(all).not.toContain('Dark theme') // hidden
    expect(all).not.toContain('Easy ease') // disabled
  })

  it('puts recent commands first without repeating them below', () => {
    const s = sections('', {
      recent: ['view.zoomFit', 'edit.undo', 'missing.command', 'file.open'],
    })
    expect(s[0]).toMatchObject({ id: 'recent', heading: 'Recent' })
    expect(titles(s[0].rows)).toEqual(['Zoom to fit', 'Open…'])
    expect(s[0].rows[0].value).toBe('recent:view.zoomFit')
    const view = s.find((x) => x.id === 'group:view')!
    expect(titles(view.rows)).not.toContain('Zoom to fit')
  })

  it('caps the recent section', () => {
    const recent = [
      'file.open',
      'file.download',
      'file.export',
      'edit.redo',
      'edit.history',
      'view.zoomIn',
    ]
    expect(sections('', { recent })[0].rows).toHaveLength(5)
  })

  it('lists only start-screen commands when no document is open', () => {
    const extra = [
      cmd('view.theme.toggle', 'view', 'Toggle theme'),
      cmd('edit.paste', 'edit', 'Paste'),
      cmd('view.toggleLeft', 'view', 'Toggle layers panel'),
    ]
    const s = buildSections({
      query: '',
      commands: buildCandidates([...COMMANDS, ...extra], en, { ...ctx, hasDocument: false }),
      layers: null,
      recent: ['view.zoomIn'],
      quick: [],
      t: en,
    })
    const all = s.flatMap((x) => titles(x.rows))
    expect(all).toEqual(
      expect.arrayContaining(['Open…', 'Toggle theme', 'Paste', 'Keyboard shortcuts']),
    )
    expect(all).not.toContain('Toggle layers panel')
    expect(all).not.toContain('Zoom in') // not even as a recent command
    // Searching still finds it.
    const found = buildSections({
      query: 'layers panel',
      commands: buildCandidates([...COMMANDS, ...extra], en, { ...ctx, hasDocument: false }),
      layers: null,
      recent: [],
      quick: [],
      t: en,
    })
    expect(found.flatMap((x) => titles(x.rows))).toContain('Toggle layers panel')
  })

  it('uses the UI language for headings', () => {
    expect(sections('', { t: ru })[0].heading).toBe('Файл')
  })
})

describe('buildSections: pages', () => {
  it('lists the other services under "Go to" with what they are for', () => {
    const goTo = sections('').find((x) => x.id === 'group:services')!
    expect(titles(goTo.rows)).toEqual(['Home', 'Customize', 'Optimizer'])
    const customize = goTo.rows[1]
    expect(customize.type === 'command' && customize.command.hint).toBe(
      en.app.services.customizeHint,
    )
  })

  it('leads with "Go to" on the home page and lists nothing that needs the editor', () => {
    const s = sections('', { route: 'home' })
    expect(headings(s)).toEqual(['Go to', 'File', 'Help'])
    const all = s.flatMap((x) => titles(x.rows))
    expect(all).toEqual(['Editor', 'Customize', 'Optimizer', 'Open…', 'Keyboard shortcuts'])
    // Saving and exporting happen where the animation is shown.
    expect(rowFor(sections('export', { route: 'home' }), 'file.export')?.destination).toBe('edit')
    expect(commandRows(s).every((r) => r.destination === null)).toBe(true)
  })

  it('offers document edits but not editor panels on the Customize page', () => {
    const extra = [
      cmd('customize.replace', 'layer', 'Replace logo…'),
      cmd('anim.speedUp', 'animation', 'Speed up 2×'),
      cmd('anim.colors', 'animation', 'Colors'),
    ]
    const s = sections('', { route: 'customize', extra })
    expect(headings(s)).toEqual(['Customize', 'File', 'Edit', 'Animation', 'Go to', 'Help'])
    const all = s.flatMap((x) => titles(x.rows))
    expect(all).toEqual(
      expect.arrayContaining(['Replace logo…', 'Redo', 'Speed up 2×', 'Optimize…']),
    )
    for (const title of ['Colors', 'Zoom to fit', 'History', 'Play / Pause', 'Customize'])
      expect(all).not.toContain(title)
  })

  it('shows recent commands that work on the page, even from sections it does not list', () => {
    const s = sections('', { route: 'customize', recent: ['view.zoomFit', 'playback.toggle'] })
    expect(s[0].id).toBe('recent')
    expect(titles(s[0].rows)).toEqual(['Play / Pause'])
  })

  it("lists the optimizer's own commands first on its page", () => {
    const extra = [cmd('optimizer.chooseFiles', 'file', 'Choose files…')]
    const s = sections('', { route: 'optimize', withDoc: false, extra })
    expect(headings(s)).toEqual(['Optimizer', 'File', 'Go to', 'Help'])
    // Elsewhere they are found by search and open their page.
    expect(sections('', { extra }).flatMap((x) => titles(x.rows))).not.toContain('Choose files…')
    expect(rowFor(sections('choose files', { extra }), 'optimizer.chooseFiles')?.destination).toBe(
      'optimize',
    )
  })

  it('marks search results that open another page', () => {
    const home = sections('zoom fit', { route: 'home' })
    expect(rowFor(home, 'view.zoomFit')?.destination).toBe('edit')
    expect(rowFor(sections('zoom fit'), 'view.zoomFit')?.destination).toBeNull()
    expect(rowFor(sections('redo', { route: 'customize' }), 'edit.redo')?.destination).toBeNull()
    expect(rowFor(sections('redo', { route: 'optimize' }), 'edit.redo')?.destination).toBe('edit')
  })

  it('offers zooming on another page, where it is disabled only because the canvas is not there', () => {
    const extra = [
      cmd('view.zoom100', 'view', 'Zoom to 100%', { enabled: () => false }),
      cmd('edit.deselect', 'edit', 'Deselect', { enabled: () => false }),
    ]
    const home = sections('zoom 100', { route: 'home', extra })
    expect(rowFor(home, 'view.zoom100')).toMatchObject({ available: true, destination: 'edit' })
    // In the editor the same state means it really cannot run.
    expect(rowFor(sections('zoom 100', { extra }), 'view.zoom100')?.available).toBe(false)
    // Other disabled commands stay disabled after a page switch too.
    expect(rowFor(sections('deselect', { route: 'home', extra }), 'edit.deselect')?.available).toBe(
      false,
    )
  })

  it('keeps a known reason over opening the page', () => {
    const extra = [cmd('view.zoomSelection', 'view', 'Zoom to selection', { enabled: () => false })]
    const row = rowFor(sections('zoom selection', { route: 'home', extra }), 'view.zoomSelection')
    expect(row).toMatchObject({ available: false })
    expect(row?.command.reason).toBe('Select a layer first')
  })

  it('finds the current service when searching, checked like in the switcher', () => {
    const s = sections('editor')
    expect(rowFor(s, 'app.edit')).toBeDefined()
  })

  it('sends layer and frame results to the pages that show them', () => {
    const layers = sections('shadow', { route: 'customize' }).find((x) => x.id === 'layers')!
    expect(layers.rows[0].destination).toBe('edit')
    expect(sections('shadow').find((x) => x.id === 'layers')!.rows[0].destination).toBeNull()
    expect(sections('12', { route: 'customize' })[0].rows[0].destination).toBeNull()
    expect(sections('12', { route: 'optimize' })[0].rows[0].destination).toBe('edit')
  })

  it('ranks a command that works here above an equal one that opens another page', () => {
    const extra = [
      cmd('customize.recolor', 'layer', 'Recolor'),
      cmd('colors.recolor', 'animation', 'Recolor'),
    ]
    const onCustomize = commandRows(sections('recolor', { route: 'customize', extra }))
    expect(onCustomize.map((r) => r.command.id).slice(0, 2)).toEqual([
      'customize.recolor',
      'colors.recolor',
    ])
    const inEditor = commandRows(sections('recolor', { extra }))
    expect(inEditor.map((r) => r.command.id).slice(0, 2)).toEqual([
      'colors.recolor',
      'customize.recolor',
    ])
  })
})

describe('buildSections: search', () => {
  it('ranks the best command first', () => {
    const [first] = sections('zoom fit')
    expect(first.id).toBe('commands')
    expect(titles(first.rows)[0]).toBe('Zoom to fit')
  })

  it('prefers the shorter title on equal matches', () => {
    const rows = sections('zoom in')[0].rows
    expect(titles(rows).slice(0, 2)).toEqual(['Zoom in', 'Zoom timeline in'])
  })

  it('lists unavailable commands after available ones', () => {
    const rows = sections('e')[0].rows.filter((r) => r.type === 'command')
    const firstDisabled = rows.findIndex((r) => r.type === 'command' && !r.command.enabled)
    const lastEnabled = rows.map((r) => r.type === 'command' && r.command.enabled).lastIndexOf(true)
    expect(firstDisabled).toBeGreaterThan(lastEnabled)
  })

  it('explains why a command is unavailable', () => {
    const rows = sections('easy ease')[0].rows
    const row = rows[0]
    expect(row.type === 'command' && row.command.reason).toBe('Select keyframes first')
  })

  it('finds layers across compositions and shows the precomp name', () => {
    const s = sections('ball')
    const layers = s.find((x) => x.id === 'layers')!
    expect(titles(layers.rows)).toEqual(['Ball', 'Ball highlight'])
    const highlight = layers.rows[1]
    expect(highlight.type === 'layer' && highlight.layer.comp).toBe('Background comp')
    expect(highlight.type === 'layer' && highlight.layer.path).toEqual(['assets', 0, 'layers', 1])
  })

  it('orders layers before commands when they match better', () => {
    expect(sections('shadow')[0].id).toBe('layers')
    expect(sections('undo')[0].id).toBe('commands')
  })

  it('finds layers by kind', () => {
    const layers = sections('text').find((x) => x.id === 'layers')
    expect(layers && titles(layers.rows)).toEqual(['Title'])
  })

  it('does not list every layer of a kind for a partial word', () => {
    // "sha" is a prefix of the kind "Shape": only the layer named Shadow should match.
    const layers = sections('sha').find((x) => x.id === 'layers')
    expect(layers && titles(layers.rows)).toEqual(['Shadow'])
  })

  it('hides unavailable commands that match much worse than the best result', () => {
    const weak = cmd('x.weak', 'edit', 'Salt pepper chai', { enabled: () => false })
    const strong = cmd('x.strong', 'edit', 'Alpha')
    expect(searchTitles('alpha', [weak, strong])).toEqual(['Alpha'])
    // Without a better match, the weak one is still worth showing (with its reason).
    expect(searchTitles('alpha', [weak])).toEqual(['Salt pepper chai'])
  })

  it('drops scattered matches that are much weaker than the best result', () => {
    const scattered = cmd('view.bg.custom', 'view', 'Custom background color')
    const undo = cmd('edit.undo', 'edit', 'Undo', { enabled: () => false })
    // "undo" only touches cUstom backgrouND cOlor letter by letter: noise next to Undo itself.
    expect(searchTitles('undo', [scattered, undo])).toEqual(['Undo'])
    // On its own it is still the best there is.
    expect(searchTitles('undo', [scattered])).toEqual(['Custom background color'])
  })

  it('prefers the title that has every word of the query over a keyword match', () => {
    const list = [
      cmd('file.export', 'file', 'Export…', { keywords: ['gif', 'video'] }),
      cmd('export.gif', 'file', 'Export as GIF…'),
    ]
    expect(searchTitles('export gif', list)[0]).toBe('Export as GIF…')
    // One word: the plain title still leads.
    expect(searchTitles('export', list)[0]).toBe('Export…')
  })

  it('ranks a keyword only one command has above one many commands share', () => {
    const colors = ['Document colors', 'Adjust colors…', 'Invert colors', 'Copy palette'].map(
      (title, i) => cmd(`colors.c${i}`, 'animation', title, { keywords: ['theme', 'palette'] }),
    )
    // The palette's own synonyms give the theme switch "theme" (see synonyms.ts).
    const theme = cmd('view.theme.toggle', 'view', 'Toggle color scheme')
    // "theme" is a keyword of every color command, but it is what the theme switch is about.
    expect(searchTitles('theme', [...colors, theme])[0]).toBe('Toggle color scheme')
  })

  it('numbers layers whose names repeat in the same composition', () => {
    const d = doc()
    const dup = {
      ...d,
      layers: [layer('Splash'), layer('Splash'), layer('Other')],
    } as unknown as Animation
    const index = buildLayerIndex(dup, en)
    expect(index.map((l) => [l.name, l.ordinal])).toEqual([
      ['Splash', 1],
      ['Splash', 2],
      ['Other', undefined],
      ['Sky', undefined],
      ['Ball highlight', undefined],
    ])
  })

  it('caps layer results and counts the rest', () => {
    const d = doc()
    const many = Array.from({ length: LAYER_LIMIT + 3 }, (_, i) => ({
      nm: `Star ${i}`,
      ty: 4,
      ip: 0,
      op: 60,
      st: 0,
      ks: {},
    }))
    const big = { ...d, layers: many } as unknown as Animation
    const s = buildSections({
      query: 'star',
      commands: [],
      layers: buildLayerIndex(big, en),
      recent: [],
      quick: [],
      t: en,
    })
    expect(s[0].rows).toHaveLength(LAYER_LIMIT)
    expect(s[0].more).toBe(3)
  })

  it('offers go-to-frame first for numbers, alongside matching commands', () => {
    const s = sections('2')
    expect(s[0].id).toBe('quick')
    expect(s[0].rows[0].type).toBe('frame')
    expect(titles(s.find((x) => x.id === 'commands')!.rows)).toContain('Speed 2×')
  })

  it('has no layers or quick actions without a document', () => {
    const s = sections('42', { withDoc: false })
    expect(s.find((x) => x.id === 'quick')).toBeUndefined()
    expect(s.find((x) => x.id === 'layers')).toBeUndefined()
  })

  it('returns nothing when nothing matches', () => {
    expect(sections('qqqzzz')).toEqual([])
  })

  it('matches English titles in the Russian UI', () => {
    const commands = buildCandidates(
      [
        titled('edit.redo', 'Redo', 'Повторить', 'edit'),
        titled('view.zoomFit', 'Zoom to fit', 'Вписать', 'view'),
      ],
      ru,
      ctx,
    )
    const s = buildSections({ query: 'zoom', commands, layers: null, recent: [], quick: [], t: ru })
    expect(titles(s[0].rows)).toEqual(['Вписать'])
    // No highlight: the visible Russian title did not match.
    expect(s[0].rows[0].type === 'command' && s[0].rows[0].positions).toEqual([])
  })

  it('understands queries typed in the wrong keyboard layout', () => {
    // "ящщь" is "zoom" typed with the Russian layout.
    expect(titles(sections('ящщь аше')[0].rows)[0]).toBe('Zoom to fit')
  })

  it('ranks an exact synonym above a title that merely starts with the word', () => {
    const list = [
      cmd('timeline.zoomFit', 'view', 'Fit timeline to panel'),
      cmd('view.zoomFit', 'view', 'Zoom to fit'),
    ]
    expect(searchTitles('fit', list)[0]).toBe('Zoom to fit')
    // The exact title still wins over a synonym.
    expect(searchTitles('zoom to fit', list)[0]).toBe('Zoom to fit')
  })

  it('ranks an exact synonym above a title prefix for long words too', () => {
    const list = [
      cmd('export.frame', 'file', 'Сохранить кадр как PNG'),
      cmd('file.download', 'file', 'Скачать', { keywords: ['сохранить'] }),
    ]
    expect(searchTitles('сохранить', list)[0]).toBe('Скачать')
  })

  it('treats a menu title with an ellipsis as an exact match', () => {
    const list = [
      cmd('optimizer.add', 'file', 'Add files to optimize…', { keywords: ['open'] }),
      cmd('file.open', 'file', 'Open…'),
    ]
    expect(searchTitles('open', list)[0]).toBe('Open…')
  })

  it('matches synonyms (compress → Optimize)', () => {
    // The command sends this animation to the optimizer; the page takes any files.
    expect(titles(sections('compress')[0].rows)).toEqual(['Optimize…', 'Optimizer'])
    expect(titles(sections('hotkeys')[0].rows)).toEqual(['Keyboard shortcuts'])
  })

  it('matches section names ("playback")', () => {
    const rows = titles(sections('playback')[0].rows)
    expect(rows).toEqual(expect.arrayContaining(['Play / Pause', 'Speed 2×']))
  })

  it('boosts recently used commands among similar matches', () => {
    const plain = titles(sections('zoom')[0].rows)
    const boosted = titles(sections('zoom', { recent: ['timeline.zoomIn'] })[0].rows)
    expect(plain.indexOf('Zoom timeline in')).toBeGreaterThan(0)
    expect(boosted[0]).toBe('Zoom timeline in')
  })

  it('highlights matched characters of the visible title', () => {
    const row = sections('zoom fit')[0].rows[0]
    expect(row.type === 'command' && row.positions).toEqual([0, 1, 2, 3, 8, 9, 10])
  })
})
