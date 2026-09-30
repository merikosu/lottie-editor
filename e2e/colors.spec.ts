/**
 * The Colors panel: recoloring a document color changes the document (list, inspector, canvas
 * and exported file agree) and undoes in one step, typed or dragged.
 */
import {
  downloadJson,
  downloadOf,
  expect,
  pressShortcut,
  test,
  type Editor,
} from './support/app.ts'
import { expectLottie, layerNamed, paintColors } from './support/lottie.ts'

/** The Ball's fill as lottie-web draws it (the renderer floors channels: 0.4196 → 106). */
const ballFill = (editor: Editor) =>
  editor.rendered(['layers', 0, 'shapes', 0]).locator('path').first()

test.beforeEach(async ({ page, editor }) => {
  await editor.openSample('bounce')
  await page.getByRole('tab', { name: 'Colors', exact: true }).click()
})

test('recolor a document color, then undo', async ({ page, editor }) => {
  const colors = page.getByRole('tree', { name: 'Colors' })
  const orange = colors.getByRole('treeitem', { name: 'FF6B4A, 1 use' })
  await expect(orange).toBeVisible()
  await expect(ballFill(editor)).toHaveAttribute('fill', 'rgb(255,106,74)')

  await orange.click()
  const picker = page.getByTestId('color-editor')
  await expect(picker).toBeVisible()
  const hex = picker.getByRole('textbox', { name: 'Hex' })
  await expect(hex).toHaveValue('FF6B4A')
  await hex.fill('2E7DFF')
  await hex.press('Enter')

  const blue = colors.getByRole('treeitem', { name: '2E7DFF, 1 use' })
  await expect(blue).toBeVisible()
  await expect(orange).toHaveCount(0)
  // The new color is stored so that it renders exactly (no off-by-one channel).
  await expect(ballFill(editor)).toHaveAttribute('fill', 'rgb(46,125,255)')

  // Close the picker (focus returns to the list), then undo with the keyboard.
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await pressShortcut(page, 'mod+z')
  await expect(orange).toBeVisible()
  await expect(blue).toHaveCount(0)
  await expect(ballFill(editor)).toHaveAttribute('fill', 'rgb(255,106,74)')
  await expect(editor.undoButton).toHaveAccessibleName('Nothing to undo')

  // Redo, and check the document itself: the inspector and the exported file.
  await pressShortcut(page, 'mod+shift+z')
  await expect(blue).toBeVisible()
  await editor.layer('Ball').click()
  await page.getByRole('tab', { name: 'Properties', exact: true }).click()
  const fillHex = editor.inspector
    .getByRole('button', { name: 'Ball Fill' })
    .locator('xpath=..')
    .getByRole('textbox', { name: 'Hex' })
  await expect(fillHex).toHaveValue('2E7DFF')

  await page.getByRole('banner').getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await dialog.getByTestId('export-format-json').click()
  const exported = await downloadJson(
    await downloadOf(page, () => dialog.getByTestId('export-submit').click()),
  )
  expectLottie(exported)
  expect(paintColors(layerNamed(exported, 'Ball')).fill).toEqual(['#2E7DFF', '#FFFFFF'])
})

test('dragging in the color picker is one undo step', async ({ page, editor }) => {
  const colors = page.getByRole('tree', { name: 'Colors' })
  await colors.getByRole('treeitem', { name: 'FF6B4A, 1 use' }).click()
  const picker = page.getByTestId('color-editor')
  const area = picker.getByRole('slider', { name: 'Color' })
  const box = await area.boundingBox()
  if (!box) throw new Error('The saturation area is not visible')

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 8 })
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, { steps: 8 })
  await page.mouse.up()

  const hex = picker.getByRole('textbox', { name: 'Hex' })
  await expect(hex).not.toHaveValue('FF6B4A')
  const dragged = await hex.inputValue()
  await expect(colors.getByRole('treeitem', { name: `${dragged}, 1 use` })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await pressShortcut(page, 'mod+z')
  await expect(colors.getByRole('treeitem', { name: 'FF6B4A, 1 use' })).toBeVisible()
  await expect(editor.undoButton).toHaveAccessibleName('Nothing to undo')
})
