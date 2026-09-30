/**
 * Export in every file format from the production build (real encoders, no mocks): each file
 * is well formed, has the animation's size and frames, and Lottie formats open again.
 */
import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { gunzipSync, strFromU8, unzipSync } from 'fflate'
import {
  chooseFiles,
  downloadBytes,
  downloadOf,
  expect,
  samplePath,
  saveDownload,
  test,
  type Editor,
} from './support/app.ts'
import { gifInfo, isMp4, isWebm, pngSize } from './support/formats.ts'
import { expectLottie } from './support/lottie.ts'

/** The "bounce" sample: 512 × 512, 30 fps, 60 frames. */
const SIZE = { width: 512, height: 512 }
const FRAMES = 60

/**
 * Opens the export dialog on `format`. `available` is false when this browser cannot produce
 * the format (the dialog says so and disables Export), e.g. H.264 in some Chromium builds.
 */
async function openExport(
  page: Page,
  format: string,
): Promise<{ dialog: Locator; available: boolean }> {
  await page.getByRole('banner').getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  const option = dialog.getByTestId(`export-format-${format}`)
  await option.click()
  await expect(option).toHaveAttribute('data-selected', 'true')
  if (await option.getByText('Not available in this browser').isVisible()) {
    await expect(dialog.getByTestId('export-submit')).toBeDisabled()
    return { dialog, available: false }
  }
  return { dialog, available: true }
}

/** Exports the open document in `format` with its default options (null: not available). */
async function exportAs(page: Page, format: string): Promise<Download | null> {
  const { dialog, available } = await openExport(page, format)
  if (!available) return null
  const download = await downloadOf(page, () => dialog.getByTestId('export-submit').click())
  await expect(dialog).toBeHidden()
  return download
}

/** Opens a saved file from the home page, as a user would, and waits for the editor. */
async function reopen(page: Page, editor: Editor, file: string): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Home' }).click()
  await chooseFiles(page, page.getByTestId('home-open-edit'), [file])
  await expect(page).toHaveURL(/#\/edit$/)
  await editor.waitUntilDrawn()
  for (const name of ['Ball', 'Shadow', 'Ground']) await expect(editor.layer(name)).toBeVisible()
}

test.beforeEach(async ({ editor }) => {
  await editor.openSample('bounce')
})

test('dotLottie: a ZIP with a manifest and the unchanged animation, which opens again', async ({
  page,
  editor,
}) => {
  const download = await exportAs(page, 'dotlottie')
  expect(download?.suggestedFilename()).toBe('bounce.lottie')
  if (!download) return
  const entries = unzipSync(new Uint8Array(await downloadBytes(download)))
  expect(Object.keys(entries).sort()).toEqual(['animations/bounce.json', 'manifest.json'])
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as {
    animations: { id: string }[]
  }
  expect(manifest.animations.map((a) => a.id)).toEqual(['bounce'])
  const animation = JSON.parse(strFromU8(entries['animations/bounce.json'])) as unknown
  expectLottie(animation)
  expect(animation).toEqual(JSON.parse(await readFile(samplePath('bounce'), 'utf8')))

  await reopen(page, editor, await saveDownload(download))
  await expect(page.getByRole('banner')).toContainText('bounce.lottie')
})

test('Telegram sticker: a gzipped Lottie at 60 fps that opens again', async ({ page, editor }) => {
  const download = await exportAs(page, 'tgs')
  expect(download?.suggestedFilename()).toBe('bounce.tgs')
  if (!download) return
  const bytes = await downloadBytes(download)
  expect(bytes.length, 'Telegram accepts stickers up to 64 KB').toBeLessThanOrEqual(64 * 1024)
  const sticker = JSON.parse(strFromU8(gunzipSync(new Uint8Array(bytes)))) as unknown
  expectLottie(sticker)
  expect(sticker).toMatchObject({ tgs: 1, w: 512, h: 512, fr: 60, ip: 0, op: 120 })

  await reopen(page, editor, await saveDownload(download))
  await expect(page.getByRole('contentinfo')).toContainText('60 fps')
})

test('one frame as a sticker: a still Lottie of the chosen frame, without keyframes', async ({
  page,
  editor,
}) => {
  const { dialog } = await openExport(page, 'tgs')
  await dialog
    .getByRole('radiogroup', { name: 'Content' })
    .getByRole('radio', { name: 'One frame' })
    .click()
  const frame = dialog.getByRole('spinbutton', { name: 'Frame' })
  await frame.fill('15')
  await frame.press('Enter')
  await expect(dialog.getByTestId('export-filename')).toHaveValue('bounce-frame-15')
  const download = await downloadOf(page, () => dialog.getByTestId('export-submit').click())
  expect(download.suggestedFilename()).toBe('bounce-frame-15.tgs')
  const bytes = await downloadBytes(download)
  const sticker = JSON.parse(strFromU8(gunzipSync(new Uint8Array(bytes)))) as {
    ip: number
    op: number
  }
  expectLottie(sticker)
  expect(sticker).toMatchObject({ tgs: 1, w: 512, h: 512, fr: 60, ip: 0 })
  // Nothing animates: no keyframe anywhere in the file.
  expect(JSON.stringify(sticker)).not.toMatch(/"a":1/)

  // The document itself is unchanged and still animated.
  await expect(editor.layer('Ball')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('60 f')
})

test('GIF: every frame at full size, looping forever', async ({ page }) => {
  const download = await exportAs(page, 'gif')
  expect(download?.suggestedFilename()).toBe('bounce.gif')
  if (!download) return
  expect(gifInfo(await downloadBytes(download))).toEqual({ ...SIZE, frames: FRAMES, loops: 0 })
})

test('video: WebM (VP9)', async ({ page }) => {
  const download = await exportAs(page, 'webm')
  test.skip(!download, 'This browser cannot encode VP9')
  expect(download?.suggestedFilename()).toBe('bounce.webm')
  if (download) expect(isWebm(await downloadBytes(download))).toBe(true)
})

test('video: MP4 (H.264)', async ({ page }) => {
  const download = await exportAs(page, 'mp4')
  // Chromium builds without proprietary codecs (Playwright's on Linux) cannot encode H.264.
  test.skip(!download, 'This browser cannot encode H.264')
  expect(download?.suggestedFilename()).toBe('bounce.mp4')
  if (download) expect(isMp4(await downloadBytes(download))).toBe(true)
})

test('PNG sequence: one full-size PNG per frame in a ZIP', async ({ page }) => {
  const download = await exportAs(page, 'png')
  expect(download?.suggestedFilename()).toBe('bounce-frames.zip')
  if (!download) return
  const entries = unzipSync(new Uint8Array(await downloadBytes(download)))
  const names = Object.keys(entries).sort()
  expect(names).toHaveLength(FRAMES)
  expect(names[0]).toBe('bounce_0000.png')
  expect(names[FRAMES - 1]).toBe(`bounce_00${FRAMES - 1}.png`)
  for (const name of names) expect(pngSize(entries[name]), name).toEqual(SIZE)
})

test('single frame: PNG and SVG of the frame at the playhead', async ({ page }) => {
  // Stills default to 2× for sharp images; the file has the size the dialog announces.
  const { dialog } = await openExport(page, 'framePng')
  await expect(dialog.getByRole('combobox', { name: 'Size' })).toHaveText('2×')
  await expect(dialog.getByTestId('export-summary')).toHaveText('Frame 0 · 1024 × 1024')
  const png = await downloadOf(page, () => dialog.getByTestId('export-submit').click())
  expect(png.suggestedFilename()).toBe('bounce-frame-0.png')
  expect(pngSize(await downloadBytes(png))).toEqual({ width: 1024, height: 1024 })
  await expect(dialog).toBeHidden()

  const svg = await exportAs(page, 'frameSvg')
  expect(svg?.suggestedFilename()).toBe('bounce-frame-0.svg')
  if (!svg) return
  const markup = (await downloadBytes(svg)).toString('utf8')
  expect(markup).toMatch(/<svg[^>]+viewBox="0 0 512 512"/)
  expect(markup).toContain('<path')
})
