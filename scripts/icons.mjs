/**
 * Renders the app icons (PNG) from the logo: the web app manifest and iOS need raster icons.
 *
 *   node scripts/icons.mjs
 *
 * Writes public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png. The logo is the
 * one in public/favicon.svg and src/app/Logo.tsx: keep them in sync.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public/icons')
const ACCENT = '#3470e8'

/** The mark (an easing curve with its two ends) in a 20 × 20 box. */
const MARK =
  '<path d="M4.5 15C9 15 8.5 5 15.5 5" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
  '<circle cx="4.5" cy="15" r="1.6" fill="white"/><circle cx="15.5" cy="5" r="1.6" fill="white"/>'

/** Rounded square on transparency, with a small margin like other desktop app icons. */
const regular = (size) => {
  const m = size * 0.0625
  const s = size - 2 * m
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect x="${m}" y="${m}" width="${s}" height="${s}" rx="${s * 0.29}" fill="${ACCENT}"/>
    <g transform="translate(${m} ${m}) scale(${s / 20})">${MARK}</g></svg>`
}

/**
 * Full-bleed square: the platform applies its own shape. `scale` is the mark's share of the side
 * (maskable icons keep it inside the central safe circle).
 */
const fullBleed = (size, scale) => {
  const s = size * scale
  const o = (size - s) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${ACCENT}"/>
    <g transform="translate(${o} ${o}) scale(${s / 20})">${MARK}</g></svg>`
}

const ICONS = [
  { file: 'icon-192.png', size: 192, svg: regular(192) },
  { file: 'icon-512.png', size: 512, svg: regular(512) },
  { file: 'icon-maskable-512.png', size: 512, svg: fullBleed(512, 0.62) },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(180, 0.78) },
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size })
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${icon.svg}</body></html>`,
    )
    await page.locator('svg').screenshot({ path: join(OUT, icon.file), omitBackground: true })
    console.log(`public/icons/${icon.file}`)
  }
} finally {
  await browser.close()
}
