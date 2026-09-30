/**
 * Offline use: after the first visit the service worker keeps the whole app, so it opens and
 * works without a connection, including the parts that load on demand (the editor workspace,
 * the samples, the export dialog, other languages).
 */
import { expect, pressShortcut, test } from './support/app.ts'

// The rest of the suite blocks service workers (playwright.config.ts).
test.use({ serviceWorkers: 'allow' })

test('after the first visit the app opens and works offline', async ({
  page,
  context,
  editor,
  consoleErrors,
}) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1, name: 'Lottie Editor' })).toBeVisible()

  // The worker installs in the background and takes over the open page.
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return registration?.active?.state === 'activated' && !!navigator.serviceWorker.controller
  })
  // Chrome shows the installed files to other contexts shortly after the install completes.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        let count = 0
        for (const key of await caches.keys())
          count += (await (await caches.open(key)).keys()).length
        return count
      }),
    )
    .toBeGreaterThan(20)

  // Offline emulation also cuts off the service worker's own requests.
  await context.setOffline(true)
  consoleErrors.allow(/ERR_INTERNET_DISCONNECTED/)
  const response = await page.reload()
  expect(response?.fromServiceWorker()).toBe(true)
  await expect(page.getByRole('heading', { level: 1, name: 'Lottie Editor' })).toBeVisible()

  // The editor workspace and the built-in samples are separate files.
  await editor.openSample('bounce')
  await expect(editor.layer('Ball')).toBeVisible()

  // So is the export dialog.
  await page.getByRole('banner').getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // And the Russian interface.
  await pressShortcut(page, 'mod+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByTestId('palette-input').fill('Русский')
  await expect(palette.getByRole('option').first()).toHaveAccessibleName(/Русский/)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menubar').getByRole('menuitem').first()).toHaveText('Файл')
})
