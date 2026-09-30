/**
 * Keyboard: the command palette (⌘K / Ctrl+K), the shortcuts sheet (?) and what its keys really
 * do, service shortcuts, Escape everywhere, and reaching every panel with Tab.
 */
import type { Page } from '@playwright/test'
import { expect, keysFromLabel, pressShortcut, test } from './support/app.ts'

test.describe('in the editor', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openSample('bounce')
  })

  test('mod+K opens the command palette and runs the chosen command', async ({ page, editor }) => {
    // Focus a control first: closing the palette gives the focus back to it.
    const goToStart = editor.timeline.getByRole('button', { name: 'Go to start' })
    await goToStart.focus()

    await pressShortcut(page, 'mod+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    const input = palette.getByTestId('palette-input')
    await expect(input).toBeFocused()

    await input.fill('go to end')
    const first = palette.getByRole('option').first()
    await expect(first).toHaveAccessibleName(/^Go to end/)
    await expect(first).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(editor.currentFrame).toHaveValue('59')
    await expect(goToStart).toBeFocused()

    // Escape clears the query first, then closes; the shortcut also toggles it closed.
    await pressShortcut(page, 'mod+k')
    await input.fill('zoom')
    await page.keyboard.press('Escape')
    await expect(input).toHaveValue('')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
    await pressShortcut(page, 'mod+k')
    await expect(palette).toBeVisible()
    await pressShortcut(page, 'mod+k')
    await expect(palette).toBeHidden()
    await expect(goToStart).toBeFocused()
  })

  test('? opens the shortcuts sheet, and its keys do what it says', async ({ page, editor }) => {
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    /** Reads a row's keys in the sheet, closes it and presses exactly those keys. */
    const pressFromSheet = async (title: string) => {
      await pressShortcut(page, '?')
      await expect(sheet).toBeVisible()
      const row = sheet
        .getByRole('listitem')
        .filter({ has: page.getByText(title, { exact: true }) })
      await expect(row).toHaveCount(1)
      // The first of the row's shortcuts (some rows list alternatives: "+ or Shift +").
      const caps = await row.locator('span:has(> kbd)').first().locator('kbd').allTextContents()
      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      await page.keyboard.press(keysFromLabel(caps))
    }

    await pressFromSheet('Go to end')
    await expect(editor.currentFrame).toHaveValue('59')
    await pressFromSheet('Go to start')
    await expect(editor.currentFrame).toHaveValue('0')

    await pressFromSheet('Show timeline')
    await expect(editor.timeline).toBeHidden()
    await pressFromSheet('Show timeline')
    await expect(editor.timeline).toBeVisible()

    await pressFromSheet('Show JSON')
    await expect(page.getByTestId('code-view')).toBeVisible()
    await pressFromSheet('Show canvas')
    await expect(page.getByTestId('code-view')).toBeHidden()
    await expect(editor.artboard).toBeVisible()

    const theme = page.locator('html')
    await expect(theme).toHaveAttribute('data-theme', 'dark')
    await pressFromSheet('Toggle theme')
    await expect(theme).toHaveAttribute('data-theme', 'light')

    // The sheet is searchable.
    await pressShortcut(page, '?')
    await sheet.getByRole('textbox', { name: 'Search shortcuts' }).fill('timeline')
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Show timeline' })).toBeVisible()
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Undo' })).toHaveCount(0)
  })

  test('Escape closes every dialog, and shortcuts keep working', async ({ page, editor }) => {
    for (const [shortcut, name] of [
      ['mod+shift+e', 'Export'],
      ['mod+,', 'Settings'],
      ['?', 'Keyboard shortcuts'],
      ['mod+k', 'Command palette'],
    ] as const) {
      await pressShortcut(page, shortcut)
      const dialog = page.getByRole('dialog', { name })
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }

    await pressShortcut(page, 'end')
    await expect(editor.currentFrame).toHaveValue('59')
  })

  // After a mouse-opened menu is closed with Escape, focus returns to where it was, so
  // single-key shortcuts (End, Space) act on the editor instead of the menu bar.
  test('after closing a menu with Escape, single-key shortcuts work again', async ({
    page,
    editor,
  }) => {
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()

    await pressShortcut(page, 'end')
    await expect(editor.currentFrame).toHaveValue('59')
    await pressShortcut(page, 'space')
    await expect(editor.timeline.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect(page.getByRole('menu')).toHaveCount(0)
  })

  test('Tab reaches every panel, in reading order', async ({ page }) => {
    const panels: string[] = []
    for (let i = 0; i < 120 && panels.length < 5; i++) {
      await page.keyboard.press('Tab')
      const panel = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return null
        if (el.closest('header')) return 'top bar'
        if (el.closest('[data-testid="layers-panel"]')) return 'layers'
        if (el.closest('[data-testid="viewport-toolbar"], [data-testid="viewport"]'))
          return 'canvas'
        if (el.closest('[data-testid="inspector"]')) return 'inspector'
        if (el.closest('[data-testid="timeline-root"]')) return 'timeline'
        return null
      })
      if (panel && !panels.includes(panel)) panels.push(panel)
    }
    expect(panels).toEqual(['top bar', 'layers', 'canvas', 'inspector', 'timeline'])
  })

  // Every control reached with Tab must look different when focused.
  test('every Tab stop shows a visible focus indicator', async ({ page }) => {
    expect(await stopsWithoutVisibleFocus(page)).toEqual([])
  })
})

test('the service shortcuts shown on the home cards switch services', async ({ page }) => {
  await page.goto('./')
  const shortcutOf = async (card: string) =>
    keysFromLabel(
      (await page.getByRole('region', { name: card, exact: true }).locator('kbd').textContent()) ??
        '',
    )
  const toCustomize = await shortcutOf('Customize')
  const toOptimizer = await shortcutOf('Optimizer')
  const toEditor = await shortcutOf('Editor')

  await page.keyboard.press(toCustomize)
  await expect(page).toHaveURL(/#\/customize$/)
  await expect(page.getByTestId('customize-start')).toBeVisible()
  await page.keyboard.press(toOptimizer)
  await expect(page).toHaveURL(/#\/optimize$/)
  await expect(page.getByTestId('opt-start')).toBeVisible()
  await page.keyboard.press(toEditor)
  await expect(page).toHaveURL(/#\/edit$/)
  await expect(page.getByTestId('welcome')).toBeVisible()
})

/**
 * Tabs through the page once and returns the Tab stops that look the same focused and not
 * focused (tooltips hidden, carets transparent: only a focus style can make a difference).
 */
async function stopsWithoutVisibleFocus(page: Page): Promise<string[]> {
  await page.addStyleTag({
    content:
      '[data-radix-popper-content-wrapper] { display: none !important } * { caret-color: transparent !important }',
  })
  const seen = new Set<string>()
  const offenders: string[] = []
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || el === document.body) return null
      // Visually hidden inputs (radio cards) draw their ring on the label around them.
      let box = el.getBoundingClientRect()
      if (box.width < 4 || box.height < 4) box = (el.closest('label') ?? el).getBoundingClientRect()
      const name =
        el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || el.tagName
      return {
        key: `${name}@${Math.round(box.x)},${Math.round(box.y)}`,
        name,
        box: box.toJSON() as DOMRectInit,
      }
    })
    if (!stop) continue
    if (seen.has(stop.key)) break
    seen.add(stop.key)
    const { x = 0, y = 0, width = 0, height = 0 } = stop.box
    const clip = {
      x: Math.max(0, x - 4),
      y: Math.max(0, y - 4),
      width: width + 8,
      height: height + 8,
    }
    const focused = await page.screenshot({ clip })
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      el.dataset.e2eFocus = ''
      el.blur()
    })
    const unfocused = await page.screenshot({ clip })
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-e2e-focus]')
      delete el?.dataset.e2eFocus
      el?.focus({ focusVisible: true } as FocusOptions)
    })
    if (focused.equals(unfocused)) offenders.push(stop.name)
  }
  return offenders
}
