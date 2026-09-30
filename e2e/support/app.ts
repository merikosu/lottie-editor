/**
 * Shared fixtures and helpers of the end-to-end suite. The suite runs against the production
 * build, which has no dev handles: everything is driven through the UI, like a user would.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test as base, type Download, type Locator, type Page } from '@playwright/test'

export { expect }

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures')
const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/samples')

/** Absolute path of a file in `e2e/fixtures`. */
export function fixture(name: string): string {
  return path.join(FIXTURES, name)
}

/** Absolute path of a built-in sample's JSON (`src/samples/<id>.json`). */
export function samplePath(id: string): string {
  return path.join(SAMPLES, `${id}.json`)
}

export interface ConsoleErrors {
  /** Console errors and uncaught exceptions seen so far. */
  readonly messages: string[]
  /** Declares an expected error: matching messages do not fail the test. */
  allow(pattern: RegExp): void
}

/**
 * `test` with a console guard: any console error or uncaught exception during a test fails it,
 * so every journey doubles as a "no runtime errors" check. `editor` gives the editor's locators.
 * (Fixture callbacks are named `provide` rather than Playwright's usual `use`, which the React
 * hooks lint rule would take for React's `use()`.)
 */
export const test = base.extend<{ consoleErrors: ConsoleErrors; editor: Editor }>({
  editor: async ({ page }, provide) => {
    await provide(new Editor(page))
  },
  consoleErrors: [
    async ({ page }, provide) => {
      const messages: string[] = []
      const allowed: RegExp[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') messages.push(msg.text())
      })
      page.on('pageerror', (err) => messages.push(`Uncaught ${err.name}: ${err.message}`))
      await provide({ messages, allow: (pattern) => allowed.push(pattern) })
      const unexpected = messages.filter((m) => !allowed.some((p) => p.test(m)))
      expect(unexpected, 'console errors and uncaught exceptions').toEqual([])
    },
    { auto: true },
  ],
})

/* -------------------------------------------------------------------------- */
/*                                  Keyboard                                  */
/* -------------------------------------------------------------------------- */

const modCache = new WeakMap<Page, 'Meta' | 'Control'>()

/**
 * The key the app treats as "mod" (⌘ on macOS, Ctrl elsewhere), detected exactly like the app
 * does (`src/lib/platform.ts`). The emulated device may claim another OS than the host, so
 * Playwright's `ControlOrMeta` (which follows the host) is not reliable here.
 */
export async function modKey(page: Page): Promise<'Meta' | 'Control'> {
  const cached = modCache.get(page)
  if (cached) return cached
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    return /Mac|iPhone|iPad|iPod/i.test(
      nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent,
    )
  })
  const key = mac ? 'Meta' : 'Control'
  modCache.set(page, key)
  return key
}

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  enter: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  home: 'Home',
  end: 'End',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
}

/**
 * Presses a shortcut written the way the app defines them ("mod+shift+z", "?", "alt+1"). Keys
 * are sent as physical key codes, which is what the app matches (any keyboard layout works).
 */
export async function pressShortcut(page: Page, shortcut: string): Promise<void> {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts.pop() ?? ''
  const modifiers: string[] = []
  for (const part of parts) {
    if (part === 'mod') modifiers.push(await modKey(page))
    else if (part === 'shift') modifiers.push('Shift')
    else if (part === 'alt') modifiers.push('Alt')
    else if (part === 'ctrl') modifiers.push('Control')
    else throw new Error(`Unknown modifier "${part}" in "${shortcut}"`)
  }
  let code: string
  if (key === '?') {
    modifiers.push('Shift')
    code = 'Slash'
  } else if (/^[a-z]$/.test(key)) code = `Key${key.toUpperCase()}`
  else if (/^[0-9]$/.test(key)) code = `Digit${key}`
  else if (/^f([1-9]|1[0-2])$/.test(key)) code = key.toUpperCase()
  else if (NAMED_KEYS[key]) code = NAMED_KEYS[key]
  else throw new Error(`Unknown key "${key}" in "${shortcut}"`)
  await page.keyboard.press([...new Set(modifiers), code].join('+'))
}

const CAP_KEYS: Record<string, string> = {
  Ctrl: 'Control',
  '⌃': 'Control',
  '⌘': 'Meta',
  Alt: 'Alt',
  '⌥': 'Alt',
  Shift: 'Shift',
  '⇧': 'Shift',
  Esc: 'Escape',
  Enter: 'Enter',
  '↩': 'Enter',
  Space: 'Space',
  Tab: 'Tab',
  '⇥': 'Tab',
  Backspace: 'Backspace',
  '⌫': 'Backspace',
  Delete: 'Delete',
  '⌦': 'Delete',
  Home: 'Home',
  '↖': 'Home',
  End: 'End',
  '↘': 'End',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  PgUp: 'PageUp',
  PgDn: 'PageDown',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '−': 'Minus',
  '+': 'Equal',
  '?': 'Shift+Slash',
}

/**
 * The keys to press for a shortcut as the app displays it: key caps (["Ctrl", "Alt", "3"],
 * ["⌥", "⌘", "3"]) or one label ("Alt+1", "⌥1"). Lets tests press exactly what the UI shows.
 */
export function keysFromLabel(label: string | string[]): string {
  let caps = Array.isArray(label) ? label : [label]
  if (caps.length === 1) {
    const text = caps[0]
    // "Ctrl+Shift+Z" (Windows, Linux) or "⇧⌘Z" (macOS: modifier glyphs, then the key).
    const glyphs = /^[⌃⌥⇧⌘]*/.exec(text)?.[0] ?? ''
    caps =
      text.length > 1 && text.includes('+')
        ? text.split('+')
        : [...glyphs, text.slice(glyphs.length)]
  }
  return caps
    .filter(Boolean)
    .map((cap) => {
      if (CAP_KEYS[cap]) return CAP_KEYS[cap]
      if (/^[A-Z]$/.test(cap)) return `Key${cap}`
      if (/^[0-9]$/.test(cap)) return `Digit${cap}`
      if (/^F([1-9]|1[0-2])$/.test(cap)) return cap
      throw new Error(`Unknown key cap "${cap}" in "${caps.join(' ')}"`)
    })
    .join('+')
}

/* -------------------------------------------------------------------------- */
/*                                Files in / out                              */
/* -------------------------------------------------------------------------- */

/** Clicks `trigger` and answers the file picker it opens with `files` (absolute paths). */
export async function chooseFiles(page: Page, trigger: Locator, files: string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await trigger.click()
  await (await chooser).setFiles(files)
}

/**
 * Drops files on `target` the way the browser does after a drag from the desktop: dragenter,
 * dragover and drop events carrying a DataTransfer with the files.
 */
export async function dropFiles(target: Locator, files: string[]): Promise<void> {
  const payload = await Promise.all(
    files.map(async (file) => ({
      name: path.basename(file),
      type: mimeType(file),
      base64: (await readFile(file)).toString('base64'),
    })),
  )
  const dataTransfer = await target.page().evaluateHandle((list) => {
    const dt = new DataTransfer()
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))
      dt.items.add(new File([bytes], f.name, { type: f.type }))
    }
    return dt
  }, payload)
  for (const type of ['dragenter', 'dragover', 'drop']) {
    await target.dispatchEvent(type, { dataTransfer })
  }
  await dataTransfer.dispose()
}

function mimeType(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.json') return 'application/json'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.lottie' || ext === '.zip') return 'application/zip'
  return 'application/octet-stream'
}

/** Runs `action` and returns the download it starts. */
export async function downloadOf(page: Page, action: () => Promise<unknown>): Promise<Download> {
  const download = page.waitForEvent('download')
  await action()
  return download
}

/** Contents of a finished download. */
export async function downloadBytes(download: Download): Promise<Buffer> {
  return readFile(await download.path())
}

/**
 * Saves a download under its own name in the test's output folder and returns the path, so it
 * can be opened again like the user's file (Playwright keeps downloads under random names).
 */
export async function saveDownload(download: Download): Promise<string> {
  const file = test.info().outputPath(download.suggestedFilename())
  await download.saveAs(file)
  return file
}

/** A downloaded file parsed as JSON (fails the test with a clear message when it is not JSON). */
export async function downloadJson(download: Download): Promise<unknown> {
  const text = (await downloadBytes(download)).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${download.suggestedFilename()} is not valid JSON: ${text.slice(0, 120)}…`)
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Editor                                   */
/* -------------------------------------------------------------------------- */

/**
 * Locators of the editor page (`#/edit`). Panels are found by test id, so they work in any UI
 * language; the controls named by their (English) label are for tests in English.
 */
export class Editor {
  readonly page: Page
  readonly layerTree: Locator
  readonly inspector: Locator
  readonly timeline: Locator
  readonly currentFrame: Locator
  readonly artboard: Locator
  readonly undoButton: Locator
  readonly redoButton: Locator

  constructor(page: Page) {
    this.page = page
    this.layerTree = page.getByTestId('layer-tree')
    this.inspector = page.getByTestId('inspector')
    this.timeline = page.getByTestId('timeline-root')
    this.currentFrame = this.timeline.getByRole('spinbutton', { name: 'Current frame' })
    this.artboard = page.getByTestId('artboard')
    this.undoButton = page
      .getByRole('banner')
      .getByRole('button', { name: /^(Undo|Nothing to undo)/ })
    this.redoButton = page
      .getByRole('banner')
      .getByRole('button', { name: /^(Redo|Nothing to redo)/ })
  }

  /** Opens a built-in sample in the editor and waits until it is drawn. */
  async openSample(id: string): Promise<void> {
    await this.page.goto(`./?sample=${id}#/edit`)
    await this.waitUntilDrawn()
  }

  /** Waits for the layer tree and the first rendered frame on the canvas. */
  async waitUntilDrawn(): Promise<void> {
    await expect(this.layerTree.getByRole('treeitem').first()).toBeVisible()
    await expect(this.artboard.locator('svg g[class*="le-n_layers_"]').first()).toBeAttached()
  }

  /** A top-level row of the layer tree, by layer name. */
  layer(name: string): Locator {
    return this.layerTree
      .getByRole('treeitem')
      .filter({ has: this.page.getByText(name, { exact: true }) })
  }

  /** The rendered group of a node on the canvas (`['layers', 0]` → `.le-n_layers_0`). */
  rendered(nodePath: (string | number)[]): Locator {
    return this.artboard.locator(`svg g.le-n_${nodePath.join('_')}`).first()
  }

  /** The current frame shown in the timeline's transport bar. */
  async frame(): Promise<number> {
    return Number(await this.currentFrame.inputValue())
  }
}
