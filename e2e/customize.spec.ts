/**
 * Customize: put your own logo into a ready-made animation. The fixture `wallet-card.json` is a
 * small file shaped like real-world wallet animations: a logo precomp made of Illustrator
 * outlines that scales in, a watermark, a card with a parented outline, a gradient background.
 */
import { readFile } from 'node:fs/promises'
import {
  chooseFiles,
  downloadJson,
  downloadOf,
  dropFiles,
  expect,
  fixture,
  saveDownload,
  test,
} from './support/app.ts'
import { expectLottie, paintColors, type Lottie } from './support/lottie.ts'
import type { Locator, Page } from '@playwright/test'

const WALLET = fixture('wallet-card.json')

async function original(): Promise<Lottie> {
  return JSON.parse(await readFile(WALLET, 'utf8')) as Lottie
}

/** Opens the wallet fixture on the Customize page through its file picker. */
async function openWallet(page: Page): Promise<void> {
  await page.goto('./#/customize')
  await chooseFiles(page, page.getByTestId('customize-choose'), [WALLET])
  await expect(page.getByTestId('customize-panel')).toContainText('wallet-card.json')
}

/** Opens the Replace dialog of the "Wallet logo" suggestion. */
async function replaceLogo(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Replace “Wallet logo”…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Replace “Wallet logo”' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('replace the logo with an SVG and export JSON with the new shapes', async ({
  page,
  editor,
}) => {
  // Home → drop the file on the Customize card.
  await page.goto('./')
  await dropFiles(page.getByTestId('service-customize'), [WALLET])
  await expect(page).toHaveURL(/#\/customize$/)
  await expect(page.getByTestId('customize-panel')).toContainText('wallet-card.json')

  // The logo precomp is the first suggestion.
  const suggestion = page.getByTestId('customize-element').first()
  await expect(suggestion.getByText('Wallet logo', { exact: true })).toBeVisible()
  await expect(suggestion.getByText('Logo', { exact: true })).toBeVisible()

  const dialog = await replaceLogo(page)
  await chooseFiles(page, dialog.getByTestId('replace-choose'), [fixture('check-badge.svg')])
  await expect(dialog.getByTestId('replace-source')).toContainText('check-badge.svg')
  await expect(dialog.getByTestId('replace-source')).toContainText('SVG, vector')
  await expect(dialog.getByTestId('replace-error')).toHaveCount(0)
  await dialog.getByTestId('replace-apply').click()
  await expect(dialog).toBeHidden()
  await expect(editor.undoButton).toHaveAccessibleName('Undo Replace “Wallet logo”')

  // The preview draws the new logo (its own colors are kept by default).
  const preview = page.getByTestId('customize-artboard')
  await expect(preview.locator('path[fill="rgb(18,184,134)"]').first()).toBeAttached()

  // Export → JSON.
  await page
    .getByTestId('customize-export')
    .getByRole('button', { name: 'JSON', exact: true })
    .click()
  const exportDialog = page.getByRole('dialog', { name: 'Export' })
  await expect(exportDialog.getByTestId('export-format-json')).toHaveAttribute(
    'data-selected',
    'true',
  )
  const download = await downloadOf(page, () => exportDialog.getByTestId('export-submit').click())
  expect(download.suggestedFilename()).toBe('wallet-card.json')

  const exported = await downloadJson(download)
  expectLottie(exported)
  const before = await original()
  const logo = exported.assets?.find((a) => a.id === 'comp_logo')
  expect(logo?.layers, 'the logo composition holds the imported SVG').toHaveLength(1)
  expect(logo?.layers?.[0]).toMatchObject({ ty: 4, nm: 'check-badge' })
  const colors = paintColors(logo)
  expect(colors.fill).toContain('#12B886')
  expect(colors.stroke).toContain('#FFFFFF')
  expect(paintColors(exported).fill, 'the old artwork is gone').not.toContain('#FFD43B')
  // Everything else is untouched, including the logo layer's scale-in.
  expect(exported.layers).toEqual(before.layers)
  expect(exported.assets?.find((a) => a.id === 'comp_bg')).toEqual(
    before.assets?.find((a) => a.id === 'comp_bg'),
  )

  // Re-open the exported file in the editor: it loads and draws the new logo.
  await page.getByRole('banner').getByRole('button', { name: 'Home' }).click()
  await chooseFiles(page, page.getByTestId('home-open-edit'), [await saveDownload(download)])
  await expect(page).toHaveURL(/#\/edit$/)
  await editor.waitUntilDrawn()
  await expect(page.getByRole('banner')).toContainText('wallet-card.json')
  await expect(editor.layer('Wallet logo')).toBeVisible()
  await expect(editor.artboard.locator('path[fill="rgb(18,184,134)"]').first()).toBeAttached()
})

test('a text-only SVG is refused with the reason, and nothing changes', async ({
  page,
  editor,
}) => {
  await openWallet(page)
  const dialog = await replaceLogo(page)
  await chooseFiles(page, dialog.getByTestId('replace-choose'), [fixture('wordmark-text.svg')])
  const alert = dialog.getByRole('alert')
  await expect(alert).toContainText('“wordmark-text.svg” has nothing that can be imported')
  await expect(alert).toContainText(
    'Text is not imported: convert it to outlines in your design tool.',
  )
  await expect(dialog.getByTestId('replace-apply')).toBeDisabled()

  await dialog.getByTestId('replace-cancel').click()
  await expect(dialog).toBeHidden()
  await expect(editor.undoButton).toHaveAccessibleName('Nothing to undo')
})

// A precomp logo that scales in is shown at its resting size (not at frame 0, where it is
// scaled to 0 and transparent), so the Logos list thumbnail shows the logo itself.
test('the Logos list shows each logo at its resting frame', async ({ page }) => {
  await openWallet(page)
  const thumb = page.getByTestId('customize-element').first().locator('img')
  await expect(thumb).toHaveAttribute('src', /^blob:/)
  // The logo is a white wallet with a yellow flap on a blue card: its thumbnail shows them.
  const share = await thumb.evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return { white: 0, yellow: 0 }
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let white = 0
    let yellow = 0
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
      if (r > 235 && g > 235 && b > 235) white++
      if (r > 235 && g > 190 && g < 230 && b < 90) yellow++
    }
    const total = data.length / 4
    return { white: white / total, yellow: yellow / total }
  })
  expect(share.white, 'white wallet body').toBeGreaterThan(0.1)
  expect(share.yellow, 'yellow flap').toBeGreaterThan(0.02)
})
