/**
 * Editor journeys on the built-in "bounce" sample: selection across panels, property edits
 * with undo/redo (one step per gesture), layer operations, editing the JSON, playback and
 * scrubbing, and a lossless JSON export.
 */
import { readFile } from 'node:fs/promises'
import {
  downloadJson,
  downloadOf,
  expect,
  pressShortcut,
  samplePath,
  test,
  type Editor,
} from './support/app.ts'
import { expectLottie, type Lottie } from './support/lottie.ts'

async function setOpacity(editor: Editor, value: string): Promise<void> {
  const opacity = editor.inspector.getByRole('spinbutton', { name: 'Opacity' })
  await opacity.fill(value)
  await opacity.press('Enter')
  await expect(opacity).toHaveValue(value)
}

test.beforeEach(async ({ editor }) => {
  await editor.openSample('bounce')
})

test('select a layer in the tree, change its opacity, undo and redo', async ({ page, editor }) => {
  const ball = editor.layer('Ball')
  await ball.click()
  await expect(ball).toHaveAttribute('aria-selected', 'true')
  await expect(editor.inspector.getByRole('button', { name: 'Ball', exact: true })).toBeVisible()

  const opacity = editor.inspector.getByRole('spinbutton', { name: 'Opacity' })
  const rendered = editor.rendered(['layers', 0])
  await expect(opacity).toHaveValue('100')
  await expect(rendered).toHaveAttribute('opacity', '1')

  await setOpacity(editor, '40')
  await expect(rendered).toHaveAttribute('opacity', '0.4')
  await expect(editor.undoButton).toHaveAccessibleName('Undo Change opacity')

  // Leave the field first: a focused text field keeps ⌘Z / Ctrl+Z for its own text.
  await opacity.press('Escape')
  await pressShortcut(page, 'mod+z')
  await expect(opacity).toHaveValue('100')
  await expect(rendered).toHaveAttribute('opacity', '1')
  await expect(editor.undoButton).toHaveAccessibleName('Nothing to undo')
  await expect(editor.redoButton).toHaveAccessibleName('Redo Change opacity')

  await pressShortcut(page, 'mod+shift+z')
  await expect(opacity).toHaveValue('40')
  await expect(rendered).toHaveAttribute('opacity', '0.4')

  // The top bar buttons do the same.
  await editor.undoButton.click()
  await expect(opacity).toHaveValue('100')
  await editor.redoButton.click()
  await expect(opacity).toHaveValue('40')
})

test('clicking a layer on the canvas selects it everywhere', async ({ editor }) => {
  await editor.rendered(['layers', 0]).click()
  await expect(editor.layer('Ball')).toHaveAttribute('aria-selected', 'true')
  await expect(editor.inspector.getByRole('button', { name: 'Ball', exact: true })).toBeVisible()
  await expect(
    editor.timeline.getByRole('treeitem').filter({ hasText: 'Ball' }).first(),
  ).toHaveAttribute('aria-selected', 'true')
})

test('scrubbing a value is one undo step, even with a pause mid-drag', async ({ page, editor }) => {
  await editor.layer('Ground').click()
  const rotation = editor.inspector.getByRole('spinbutton', { name: 'Rotation' })
  await expect(rotation).toHaveValue('0')

  const box = await rotation.boundingBox()
  if (!box) throw new Error('The rotation field is not visible')
  const y = box.y + box.height / 2
  const x = box.x + 16
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 20, y, { steps: 5 })
  // Longer than the 1.5 s window in which separate edits would merge anyway.
  await page.waitForTimeout(1_600)
  await page.mouse.move(x + 45, y, { steps: 5 })
  await page.mouse.up()
  await expect(rotation).toHaveValue('45')
  await expect(editor.undoButton).toHaveAccessibleName('Undo Change rotation')

  await pressShortcut(page, 'mod+z')
  await expect(rotation).toHaveValue('0')
  await expect(editor.undoButton).toHaveAccessibleName('Nothing to undo')
})

test('rename, duplicate, reorder and delete layers: one undo step each', async ({
  page,
  editor,
}) => {
  const rows = editor.layerTree.getByRole('treeitem')
  await editor.layer('Ball').click()

  await pressShortcut(page, 'f2')
  const rename = page.getByRole('textbox', { name: 'Rename' })
  await expect(rename).toHaveValue('Ball')
  await rename.fill('Hero ball')
  await rename.press('Enter')
  await expect(rows).toHaveText(['Hero ball', 'Shadow', 'Ground'])
  await expect(editor.undoButton).toHaveAccessibleName('Undo Rename layer')

  await pressShortcut(page, 'mod+d')
  await expect(rows).toHaveText(['Hero ball copy', 'Hero ball', 'Shadow', 'Ground'])
  await expect(editor.rendered(['layers', 3])).toBeAttached()
  await expect(editor.undoButton).toHaveAccessibleName('Undo Duplicate layer')

  await pressShortcut(page, 'mod+[')
  await expect(rows).toHaveText(['Hero ball', 'Hero ball copy', 'Shadow', 'Ground'])
  await expect(editor.undoButton).toHaveAccessibleName('Undo Send backward')

  await pressShortcut(page, 'delete')
  await expect(rows).toHaveText(['Hero ball', 'Shadow', 'Ground'])
  await expect(editor.rendered(['layers', 3])).not.toBeAttached()
  await expect(editor.undoButton).toHaveAccessibleName('Undo Delete layer')

  // Back to the original file, one step at a time.
  for (const [names, next] of [
    [['Hero ball', 'Hero ball copy', 'Shadow', 'Ground'], 'Undo Send backward'],
    [['Hero ball copy', 'Hero ball', 'Shadow', 'Ground'], 'Undo Duplicate layer'],
    [['Hero ball', 'Shadow', 'Ground'], 'Undo Rename layer'],
    [['Ball', 'Shadow', 'Ground'], 'Nothing to undo'],
  ] as const) {
    await pressShortcut(page, 'mod+z')
    await expect(rows).toHaveText([...names])
    await expect(editor.undoButton).toHaveAccessibleName(next)
  }
})

test('edit the JSON with find & replace, apply as one undo step; broken JSON is refused', async ({
  page,
  editor,
}) => {
  await page.getByRole('radio', { name: 'JSON', exact: true }).click()
  await page.getByTestId('code-editor').locator('.cm-content').click()
  await pressShortcut(page, 'mod+f')
  const search = page.getByTestId('code-search')
  const find = search.getByRole('textbox', { name: 'Find' })
  const replace = search.getByRole('textbox', { name: 'Replace' })
  await expect(find).toBeFocused()
  await find.fill('"Ground"')
  await expect(search.getByRole('status')).toHaveText('1 of 2')
  await search.getByRole('button', { name: 'Toggle replace' }).click()
  await replace.fill('"Floor"')
  await search.getByRole('button', { name: 'Replace all' }).click()

  // Nothing changes until the edit is applied.
  await expect(page.getByTestId('code-dirty')).toHaveText('Not applied')
  await expect(editor.layer('Ground')).toBeVisible()
  await page.getByTestId('code-apply').click()
  await expect(editor.layer('Floor')).toBeVisible()
  await expect(editor.undoButton).toHaveAccessibleName('Undo Edit JSON')

  // Broken JSON: the error says where and what, and it cannot be applied.
  await find.fill('"Floor"')
  await replace.fill('Floor')
  await search.getByRole('button', { name: 'Replace all' }).click()
  const error = page.getByTestId('code-error')
  await expect(error).toContainText(/Line \d+:\d+/)
  await expect(error).toContainText('Unknown value “Floor”')
  await expect(page.getByTestId('code-apply')).toBeDisabled()
  await page.getByTestId('code-revert').click()
  await expect(error).toHaveCount(0)

  await editor.undoButton.click()
  await expect(editor.layer('Ground')).toBeVisible()
  await expect(editor.undoButton).toHaveAccessibleName('Nothing to undo')
})

test('play, pause and scrub the timeline', async ({ page, editor }) => {
  const play = editor.timeline.getByRole('button', { name: 'Play', exact: true })
  const pause = editor.timeline.getByRole('button', { name: 'Pause', exact: true })
  await expect(editor.currentFrame).toHaveValue('0')

  await play.click()
  await expect(pause).toBeVisible()
  await expect.poll(() => editor.frame()).toBeGreaterThan(5)
  await pause.click()
  await expect(play).toBeVisible()
  const stopped = await editor.frame()
  await page.waitForTimeout(300)
  expect(await editor.frame(), 'paused playback stays on its frame').toBe(stopped)

  // Scrub along the ruler: the playhead follows the pointer and the canvas redraws.
  await pressShortcut(page, 'home')
  await expect(editor.currentFrame).toHaveValue('0')
  const ball = editor.rendered(['layers', 0])
  const atStart = await ball.getAttribute('transform')

  const ruler = editor.timeline.locator('[data-ctx="ruler"]')
  const box = await ruler.boundingBox()
  if (!box) throw new Error('The timeline ruler is not visible')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.5, y)
  await page.mouse.down()
  await expect.poll(() => editor.frame()).toBeGreaterThanOrEqual(25)
  const middle = await editor.frame()
  expect(middle).toBeLessThanOrEqual(35)
  await page.mouse.move(box.x + box.width * 0.9, y, { steps: 6 })
  await expect.poll(() => editor.frame()).toBeGreaterThan(middle + 10)
  await page.mouse.up()
  expect(await editor.frame()).toBeLessThanOrEqual(59)
  await expect(ball).not.toHaveAttribute('transform', atStart ?? '')
})

test('export JSON downloads a valid Lottie with the edit and nothing else changed', async ({
  page,
  editor,
}) => {
  await editor.layer('Ball').click()
  await setOpacity(editor, '40')

  await page.getByRole('banner').getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  // A fresh profile starts on GIF; pick the Lottie JSON format.
  await dialog.getByTestId('export-format-json').click()
  await expect(dialog.getByTestId('export-summary')).toContainText('Minified')

  const download = await downloadOf(page, () => dialog.getByTestId('export-submit').click())
  expect(download.suggestedFilename()).toBe('bounce.json')
  await expect(dialog).toBeHidden()

  const exported = await downloadJson(download)
  expectLottie(exported)
  // A round trip keeps every field of the file: the export is the sample plus the one edit.
  const expected = JSON.parse(await readFile(samplePath('bounce'), 'utf8')) as Lottie
  expected.layers[0].ks.o.k = 40
  expect(exported).toEqual(expected)
})
