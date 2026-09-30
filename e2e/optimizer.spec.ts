/**
 * Optimizer: files come out smaller, verified identical frame by frame, and the downloads are
 * valid Lottie files that open in the editor again.
 */
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import {
  chooseFiles,
  downloadBytes,
  downloadJson,
  downloadOf,
  dropFiles,
  expect,
  fixture,
  samplePath,
  saveDownload,
  test,
} from './support/app.ts'
import { expectLottie, type Lottie } from './support/lottie.ts'

/** Size of a JSON file written without whitespace (what the optimizer compares against). */
async function minifiedSize(file: string): Promise<number> {
  const text = JSON.stringify(JSON.parse(await readFile(file, 'utf8')))
  return Buffer.byteLength(text)
}

async function readLottie(file: string): Promise<Lottie> {
  const anim = JSON.parse(await readFile(file, 'utf8')) as unknown
  expectLottie(anim)
  return anim
}

/** The optimized file keeps what players and editors rely on: canvas, timing and layers. */
function expectSameAnimation(optimized: Lottie, source: Lottie): void {
  expect({
    w: optimized.w,
    h: optimized.h,
    fr: optimized.fr,
    ip: optimized.ip,
    op: optimized.op,
  }).toEqual({ w: source.w, h: source.h, fr: source.fr, ip: source.ip, op: source.op })
  expect(optimized.layers.map((l) => l.ty)).toEqual(source.layers.map((l) => l.ty))
}

test('optimize a sample: smaller, identical, and the download opens in the editor', async ({
  page,
  editor,
}) => {
  await page.goto('./#/optimize')
  await page.getByTestId('opt-start').getByRole('button', { name: 'Bouncing ball' }).click()

  const detail = page.getByTestId('opt-detail')
  await expect(detail).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('opt-result-saving')).toHaveText(/^−\d+(\.\d)?%$/)
  await expect(page.getByTestId('opt-result')).toContainText('Identical')

  const download = await downloadOf(page, () => page.getByTestId('opt-download').click())
  expect(download.suggestedFilename()).toBe('bounce.json')
  const bytes = await downloadBytes(download)
  expect(bytes.length).toBeLessThan(await minifiedSize(samplePath('bounce')))
  const optimized = await downloadJson(download)
  expectLottie(optimized)
  expectSameAnimation(optimized, await readLottie(samplePath('bounce')))

  // Re-open the optimized file in the editor.
  await page.getByRole('banner').getByRole('button', { name: 'Home' }).click()
  await chooseFiles(page, page.getByTestId('home-open-edit'), [await saveDownload(download)])
  await expect(page).toHaveURL(/#\/edit$/)
  await editor.waitUntilDrawn()
  await expect(page.getByRole('banner')).toContainText('bounce.json')
  for (const name of ['Ball', 'Shadow', 'Ground']) await expect(editor.layer(name)).toBeVisible()
})

test('a dropped batch: every file done, download all as a ZIP, open one in the editor', async ({
  page,
  editor,
}) => {
  const files = [samplePath('loader'), fixture('wallet-card.json')]
  await page.goto('./#/optimize')
  await dropFiles(page.getByTestId('opt-start'), files)

  const rows = page.getByTestId('opt-row')
  await expect(rows).toHaveCount(2)
  for (const row of await rows.all()) await expect(row).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('opt-summary')).toContainText('2 files')
  await expect(page.getByTestId('opt-all-identical')).toBeVisible()

  const zip = await downloadOf(page, () => page.getByTestId('opt-download-all').click())
  expect(zip.suggestedFilename()).toMatch(/\.zip$/)
  const entries = unzipSync(new Uint8Array(await downloadBytes(zip)))
  expect(Object.keys(entries).sort()).toEqual(['loader.json', 'wallet-card.json'])
  for (const [name, source] of [
    ['loader.json', samplePath('loader')],
    ['wallet-card.json', fixture('wallet-card.json')],
  ] as const) {
    const text = strFromU8(entries[name])
    expect(Buffer.byteLength(text), `${name} got smaller`).toBeLessThan(await minifiedSize(source))
    const optimized = JSON.parse(text) as unknown
    expectLottie(optimized)
    expectSameAnimation(optimized, await readLottie(source))
  }

  const wallet = rows.filter({ hasText: 'wallet-card.json' })
  await wallet.getByRole('button', { name: 'Open in editor' }).click()
  await expect(page).toHaveURL(/#\/edit$/)
  await editor.waitUntilDrawn()
  for (const name of ['Watermark', 'Wallet logo', 'Card outline', 'Card', 'Background']) {
    await expect(editor.layer(name)).toBeVisible()
  }
})
