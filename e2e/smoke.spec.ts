/**
 * Smoke: the home page and every service load from a cold start, by URL and through the
 * service switcher, without console errors (the console guard in support/app.ts fails a test
 * on any error or uncaught exception).
 */
import { Editor, expect, test } from './support/app.ts'

test('home renders the three services and the samples', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveTitle('Lottie Editor')
  await expect(page.getByRole('heading', { level: 1, name: 'Lottie Editor' })).toBeVisible()

  const services = [
    { name: 'Editor', action: 'Open file…' },
    { name: 'Customize', action: 'Choose a Lottie…' },
    { name: 'Optimizer', action: 'Optimize files…' },
  ]
  for (const { name, action } of services) {
    const card = page.getByRole('region', { name, exact: true })
    await expect(card.getByRole('heading', { level: 2, name })).toBeVisible()
    await expect(card.getByRole('button', { name: action })).toBeEnabled()
  }

  const samples = page.getByRole('region', { name: 'Samples' }).getByRole('listitem')
  await expect(samples).toHaveCount(8)
  await expect(samples.first()).toContainText('Bouncing ball')
})

// Each route from a cold start (a fresh page load, not a hash change of a running app).
const ROUTES = [
  { hash: '#/edit', page: 'welcome', action: 'welcome-open' },
  { hash: '#/customize', page: 'customize-start', action: 'customize-choose' },
  { hash: '#/optimize', page: 'opt-start', action: 'opt-choose' },
]
for (const route of ROUTES) {
  test(`${route.hash} loads without a document`, async ({ page }) => {
    await page.goto(`./${route.hash}`)
    await expect(page.getByTestId(route.page)).toBeVisible()
    await expect(page.getByTestId(route.action)).toBeEnabled()
  })
}

test('an unknown route falls back to home', async ({ page }) => {
  await page.goto('./#/nowhere')
  await expect(page.getByRole('heading', { level: 1, name: 'Lottie Editor' })).toBeVisible()
})

test('the service switcher moves one document between the services', async ({ page }) => {
  const editor = new Editor(page)
  await editor.openSample('bounce')
  await expect(editor.layer('Ball')).toBeVisible()
  await expect(editor.inspector).toBeVisible()
  await expect(editor.timeline).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('512 × 512')

  // Icon-only in the editor's top bar, but still named for assistive technology.
  const switcher = page.getByRole('navigation', { name: 'Services' })
  const edit = switcher.getByRole('button', { name: 'Editor' })
  const customize = switcher.getByRole('button', { name: 'Customize' })
  const optimize = switcher.getByRole('button', { name: 'Optimizer' })
  await expect(edit).toHaveAttribute('aria-current', 'page')

  await customize.click()
  await expect(page).toHaveURL(/#\/customize$/)
  await expect(customize).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('customize-panel')).toContainText('bounce.json')
  await expect(page.getByTestId('customize-artboard').locator('svg')).toBeAttached()

  await optimize.click()
  await expect(page).toHaveURL(/#\/optimize$/)
  await expect(page.getByTestId('opt-start-document')).toHaveText(/bounce\.json/)

  // Hash routes live in the browser history.
  await page.goBack()
  await expect(page.getByTestId('customize-panel')).toBeVisible()
  await page.goBack()
  await expect(editor.layer('Ball')).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: 'Home' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByTestId('home-current')).toContainText('bounce.json')
})
