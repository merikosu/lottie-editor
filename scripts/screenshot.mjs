#!/usr/bin/env node
/**
 * Dev helper: screenshots the running app with Playwright.
 *
 *   node scripts/screenshot.mjs --url "http://localhost:5173/?sample=bounce" --out shot.png \
 *     [--width 1440] [--height 900] [--theme dark|light] [--lang en|ru] [--wait 800] \
 *     [--click "selector"]... [--press "Space"]... [--eval "js expression"]... [--full]
 *
 * Steps (--click/--press/--eval/--wait-for) run in the order given, after the page loads.
 * Console errors and page errors are printed to stderr.
 */
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const opts = {
  url: 'http://localhost:5173/',
  out: 'screenshot.png',
  width: 1440,
  height: 900,
  theme: 'dark',
  lang: 'en',
  wait: 800,
  full: false,
}
const steps = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  const next = () => args[++i]
  switch (a) {
    case '--url':
      opts.url = next()
      break
    case '--out':
      opts.out = next()
      break
    case '--width':
      opts.width = Number(next())
      break
    case '--height':
      opts.height = Number(next())
      break
    case '--theme':
      opts.theme = next()
      break
    case '--lang':
      opts.lang = next()
      break
    case '--wait':
      opts.wait = Number(next())
      break
    case '--full':
      opts.full = true
      break
    case '--click':
      steps.push({ type: 'click', value: next() })
      break
    case '--dblclick':
      steps.push({ type: 'dblclick', value: next() })
      break
    case '--hover':
      steps.push({ type: 'hover', value: next() })
      break
    case '--press':
      steps.push({ type: 'press', value: next() })
      break
    case '--eval':
      steps.push({ type: 'eval', value: next() })
      break
    case '--wait-for':
      steps.push({ type: 'waitFor', value: next() })
      break
    case '--sleep':
      steps.push({ type: 'sleep', value: Number(next()) })
      break
    default:
      console.error(`Unknown argument: ${a}`)
      process.exit(2)
  }
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: opts.width, height: opts.height },
  deviceScaleFactor: 2,
})
await context.addInitScript(
  ({ theme, lang }) => {
    const key = 'lottie-editor:prefs'
    try {
      const current = JSON.parse(localStorage.getItem(key) || '{"state":{},"version":1}')
      current.state = { ...current.state, theme, language: lang }
      localStorage.setItem(key, JSON.stringify(current))
    } catch {}
  },
  { theme: opts.theme, lang: opts.lang },
)
const page = await context.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.error('[console]', m.text())
})
page.on('pageerror', (e) => console.error('[pageerror]', e.message))
await page.goto(opts.url, { waitUntil: 'networkidle' })
await page.waitForTimeout(opts.wait)
for (const s of steps) {
  if (s.type === 'click') await page.click(s.value)
  else if (s.type === 'dblclick') await page.dblclick(s.value)
  else if (s.type === 'hover') await page.hover(s.value)
  else if (s.type === 'press') await page.keyboard.press(s.value)
  else if (s.type === 'eval') console.log(await page.evaluate(s.value))
  else if (s.type === 'waitFor') await page.waitForSelector(s.value)
  else if (s.type === 'sleep') await page.waitForTimeout(s.value)
  await page.waitForTimeout(150)
}
await page.screenshot({ path: opts.out, fullPage: opts.full })
await browser.close()
console.log(`saved ${opts.out}`)
