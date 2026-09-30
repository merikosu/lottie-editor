/**
 * Big files stay responsive: an 800-layer animation (the size of the heaviest real files the
 * editor is tuned for) opens quickly, long lists are virtualized, and search, selection, edits
 * and playback answer at once. Expectation timeouts double as freeze detectors.
 */
import { writeFile } from 'node:fs/promises'
import { chooseFiles, expect, test } from './support/app.ts'
import type { Lottie, LottieLayer } from './support/lottie.ts'

const LAYERS = 800

/** A static property value. */
const value = (k: unknown) => ({ a: 0, k })

/** A grid of animated dots, one shape layer each, with a different color per layer. */
function bigAnimation(count: number): Lottie {
  const layers = Array.from({ length: count }, (_, i): LottieLayer & Record<string, unknown> => {
    const x = 32 + (i % 30) * 32
    const y = 32 + Math.floor(i / 30) * 32
    const color = [((i * 37) % 256) / 255, ((i * 91) % 256) / 255, 0.5, 1]
    return {
      ddd: 0,
      ind: i + 1,
      ty: 4,
      nm: `Dot ${i + 1}`,
      sr: 1,
      ao: 0,
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
      ks: {
        o: value(100),
        r: value(0),
        a: value([0, 0, 0]),
        s: value([100, 100, 100]),
        p: {
          a: 1,
          k: [
            { t: 0, s: [x, y, 0], o: { x: 0.33, y: 0 }, i: { x: 0.67, y: 1 } },
            { t: 60, s: [x, y + 16, 0] },
          ],
        },
      },
      shapes: [
        {
          ty: 'gr',
          nm: 'Dot',
          it: [
            { ty: 'el', d: 1, s: value([20, 20]), p: value([0, 0]), nm: 'Ellipse' },
            { ty: 'fl', c: value(color), o: value(100), r: 1, bm: 0, nm: 'Fill' },
            {
              ty: 'tr',
              p: value([0, 0]),
              a: value([0, 0]),
              s: value([100, 100]),
              r: value(0),
              o: value(100),
              sk: value(0),
              sa: value(0),
              nm: 'Transform',
            },
          ],
        },
      ],
    }
  })
  return { v: '5.7.4', fr: 30, ip: 0, op: 60, w: 1024, h: 1024, nm: 'Dots', layers, assets: [] }
}

test('an 800-layer file opens fast and stays responsive', async ({ page, editor }) => {
  const file = test.info().outputPath('dots.json')
  await writeFile(file, JSON.stringify(bigAnimation(LAYERS)))

  await page.goto('./')
  await chooseFiles(page, page.getByTestId('home-open-edit'), [file])
  await expect(editor.layerTree.getByRole('treeitem').first()).toBeVisible({ timeout: 10_000 })
  await expect(editor.rendered(['layers', LAYERS - 1])).toBeAttached({ timeout: 10_000 })
  await expect(page.getByRole('contentinfo')).toContainText('1024 × 1024')

  // Long lists render only what is on screen.
  expect(await editor.layerTree.getByRole('treeitem').count()).toBeLessThan(100)
  expect(await editor.timeline.getByRole('treeitem').count()).toBeLessThan(100)
  await expect(editor.timeline).toContainText(`${LAYERS} layers`)

  // Find the last layer, select it and edit it: every step answers within a second or two.
  await page.getByTestId('layer-search').fill(`Dot ${LAYERS}`)
  const last = editor.layer(`Dot ${LAYERS}`)
  await expect(last).toBeVisible({ timeout: 2_000 })
  await last.click()
  const header = editor.inspector.getByRole('button', { name: `Dot ${LAYERS}`, exact: true })
  await expect(header).toBeVisible({ timeout: 2_000 })

  const opacity = editor.inspector.getByRole('spinbutton', { name: 'Opacity' })
  await opacity.fill('50')
  await opacity.press('Enter')
  await expect(editor.rendered(['layers', LAYERS - 1])).toHaveAttribute('opacity', '0.5', {
    timeout: 2_000,
  })
  await opacity.press('Escape')

  // Playback runs and stops.
  await editor.timeline.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => editor.frame(), { timeout: 3_000 }).toBeGreaterThan(10)
  await editor.timeline.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(editor.timeline.getByRole('button', { name: 'Play', exact: true })).toBeVisible()

  // The Colors panel lists the 800 colors without choking either.
  await page.getByRole('tab', { name: 'Colors', exact: true }).click()
  const colors = page.getByRole('tree', { name: 'Colors' }).getByRole('treeitem')
  await expect(colors.first()).toBeVisible({ timeout: 2_000 })
  expect(await colors.count()).toBeLessThan(150)
})
