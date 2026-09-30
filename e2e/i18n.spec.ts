/**
 * Russian UI: switching the language (Settings, command palette), translated chrome with Russian
 * plurals, decimal commas and units, persistence across reloads, and no English leftovers.
 */
import type { Page } from '@playwright/test'
import { expect, pressShortcut, test } from './support/app.ts'

/** Starts the app in Russian, as a returning user who chose it earlier would. */
async function preferRussian(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'lottie-editor:prefs'
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ state: { language: 'ru' }, version: 1 }))
    }
  })
}

/** The editor chrome of the "loader" sample (2 layers, 60 fps, 90 frames = 1.5 s) in Russian. */
async function expectRussianEditor(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await expect(page.getByRole('menubar').getByRole('menuitem')).toHaveText([
    'Файл',
    'Правка',
    'Вид',
    'Анимация',
    'Слой',
    'Ключи',
    'Воспроизведение',
    'Справка',
  ])
  await expect(page.getByRole('tab')).toHaveText([
    'Слои',
    'Ресурсы',
    'История',
    'Свойства',
    'Цвета',
    'Проблемы',
  ])
  const banner = page.getByRole('banner')
  await expect(banner.getByRole('button', { name: 'Экспорт', exact: true })).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Нечего отменять' })).toBeDisabled()
  const timeline = page.getByRole('region', { name: 'Таймлайн' })
  await expect(timeline.getByRole('button', { name: 'Воспроизвести', exact: true })).toBeVisible()
  await expect(timeline.getByRole('spinbutton', { name: 'Текущий кадр' })).toHaveValue('0')
  // Russian plurals, decimal comma and units.
  await expect(timeline).toContainText('2 слоя')
  const status = page.getByRole('contentinfo')
  await expect(status).toContainText('60 к/с')
  await expect(status).toContainText('90 к · 1,5 с')
  const duration = page.getByTestId('inspector').getByRole('spinbutton', { name: 'Длительность' })
  await expect(duration).toHaveValue('1,5')
}

test('switch to Russian in Settings: the editor is translated, also after a reload', async ({
  page,
  editor,
}) => {
  await editor.openSample('loader')
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Help' }).click()
  await page.getByRole('menuitem', { name: 'Settings…' }).click()
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('combobox', { name: 'Language' })
    .click()
  await page.getByRole('option', { name: 'Русский' }).click()

  const settings = page.getByRole('dialog', { name: 'Настройки' })
  await expect(settings.getByRole('combobox', { name: 'Язык' })).toHaveText('Русский')
  await settings.getByRole('button', { name: 'Готово' }).click()
  await expect(settings).toBeHidden()
  await expectRussianEditor(page)

  await page.reload()
  await editor.waitUntilDrawn()
  await expectRussianEditor(page)
})

test('switch the language from the command palette, searching in either language', async ({
  page,
  editor,
}) => {
  await editor.openSample('bounce')
  const palette = page.getByTestId('command-palette')

  // A Russian query finds the command while the interface is in English…
  await pressShortcut(page, 'mod+k')
  await palette.getByTestId('palette-input').fill('язык')
  await palette.getByRole('option', { name: /^Русский/ }).click()
  await expect(palette).toBeHidden()
  await expect(page.getByRole('menubar').getByRole('menuitem').first()).toHaveText('Файл')

  // …and an English one while it is in Russian.
  await pressShortcut(page, 'mod+k')
  await palette.getByTestId('palette-input').fill('language')
  await palette.getByRole('option', { name: /^English/ }).click()
  await expect(page.getByRole('menubar').getByRole('menuitem').first()).toHaveText('File')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

/* -------------------------------------------------------------------------- */
/*                              English leftovers                             */
/* -------------------------------------------------------------------------- */

/**
 * Latin words that are right in a Russian interface: format and technology names, key caps
 * (the suite emulates Windows: Ctrl, Shift…), the product name and the sample document's own
 * content (layer, marker and file names, its metadata).
 */
const ALLOWED = new Set(
  [
    // Formats and technologies.
    'JSON json SVG svg GIF gif PNG png MP4 mp4 WebM webm ZIP zip tgs lottie dotLottie Lottie',
    'Telegram gzip Gzip HEX RGB HSL HSB VP9 H264 HTML React URL CSS iOS Android Bodymovin',
    // Key caps.
    'Ctrl Shift Alt Esc Enter Tab Space Home End PgUp PgDn Backspace Delete',
    // Product name.
    'Editor',
    // Content of the "bounce" sample: file, animation, layer, shape and marker names.
    'bounce Bouncing ball Ball Shadow Ground Highlight Fill fall rise Made with',
  ]
    .join(' ')
    .split(' '),
)

/** Labels allowed to contain Latin text (sonner's hotkey hint in the toast region label). */
const KNOWN_ISSUES = ['Уведомления alt+T']

/** Latin words in the visible text and accessible labels of the page, outside the document. */
async function englishLeftovers(page: Page): Promise<string[]> {
  const words = await page.evaluate((known) => {
    const found = new Set<string>()
    const add = (text: string) => {
      if (known.includes(text)) return
      for (const w of text.match(/[A-Za-z][A-Za-z'’]{2,}/g) ?? []) found.add(w)
    }
    // Drawn animations, the JSON code and hidden or decorative nodes are not interface text.
    const notInterface = 'svg, .cm-editor, [aria-hidden="true"]'
    const skip = (el: Element) =>
      !!el.closest(notInterface) || getComputedStyle(el).visibility === 'hidden'
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement
      if (el && !skip(el) && el.getClientRects().length > 0)
        add(walker.currentNode.textContent ?? '')
    }
    for (const el of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
      if (skip(el)) continue
      for (const attr of ['aria-label', 'title', 'placeholder']) add(el.getAttribute(attr) ?? '')
    }
    return [...found]
  }, KNOWN_ISSUES)
  return words.filter((w) => !ALLOWED.has(w) && !/^[0-9A-F]{6}$/.test(w)).sort()
}

test('the Russian interface has no English leftovers', async ({ page, editor }) => {
  await preferRussian(page)
  const pages: string[] = []
  const check = async (name: string) => {
    const leftovers = await englishLeftovers(page)
    if (leftovers.length) pages.push(`${name}: ${leftovers.join(', ')}`)
  }

  await page.goto('./')
  await expect(page.getByRole('region', { name: 'Редактор', exact: true })).toBeVisible()
  await check('home')

  await editor.openSample('bounce')
  await check('editor')
  await editor.layer('Ball').click()
  await check('editor, layer selected')
  await page.getByRole('tab', { name: 'Цвета' }).click()
  await check('colors panel')
  await page.getByRole('tab', { name: 'Проблемы' }).click()
  await check('issues panel')

  await pressShortcut(page, 'mod+shift+e')
  const exportDialog = page.getByRole('dialog', { name: 'Экспорт' })
  await expect(exportDialog).toBeVisible()
  await check('export dialog (GIF)')
  await exportDialog.getByTestId('export-format-json').click()
  await check('export dialog (JSON)')
  await page.keyboard.press('Escape')
  await expect(exportDialog).toBeHidden()

  await pressShortcut(page, '?')
  await expect(page.getByTestId('shortcuts-sheet')).toBeVisible()
  await check('shortcuts sheet')
  await page.keyboard.press('Escape')

  await page.goto('./?sample=bounce#/customize')
  await expect(page.getByTestId('customize-panel')).toBeVisible()
  await check('customize')

  await page.goto('./#/optimize')
  await page.getByTestId('opt-start').getByRole('button', { name: 'Прыгающий мяч' }).click()
  await expect(page.getByTestId('opt-detail')).toHaveAttribute('data-status', 'done')
  await check('optimizer')

  expect(pages, 'untranslated words').toEqual([])
})

// The toast region is labelled in the UI language (sonner appends its "alt+T" hotkey hint).
test('the notifications region is labelled in Russian', async ({ page }) => {
  await preferRussian(page)
  await page.goto('./')
  await expect(page.getByRole('region', { name: /^Уведомления/ })).toBeAttached()
})
