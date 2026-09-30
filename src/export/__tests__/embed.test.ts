import { describe, expect, it } from 'vitest'
import {
  DOTLOTTIE_WC_CDN,
  LOTTIE_WEB_CDN,
  buildEmbedSnippet,
  componentName,
  embedFileExtension,
  scriptSafeJson,
  standaloneHtml,
  type EmbedOptions,
} from '../embed'

const doc = { w: 512, h: 256, nm: 'Bouncing ball' }
const opts = (patch: Partial<EmbedOptions> = {}): EmbedOptions => ({
  flavor: 'html',
  loop: true,
  autoplay: true,
  renderer: 'svg',
  inline: false,
  ...patch,
})

describe('embed snippets', () => {
  it('loads lottie-web from the pinned CDN and references the file', () => {
    const { code, install } = buildEmbedSnippet(doc, opts(), 'bounce.json')
    expect(code).toContain(`<script src="${LOTTIE_WEB_CDN}"></script>`)
    expect(LOTTIE_WEB_CDN).toBe(
      'https://cdn.jsdelivr.net/npm/lottie-web@5.13.0/build/player/lottie.min.js',
    )
    expect(code).toContain("path: 'bounce.json',")
    expect(code).toContain("renderer: 'svg',")
    expect(code).toContain('loop: true,')
    expect(code).toContain('width: 512px; height: 256px')
    expect(install).toBeNull()
  })

  it('inlines the JSON safely and collapses it in the preview', () => {
    const json = JSON.stringify({ t: '</script><script>alert(1)</script>', s: '\u2028' })
    const snippet = buildEmbedSnippet(
      doc,
      opts({ inline: true, loop: false, renderer: 'canvas' }),
      'x.html',
      json,
    )
    expect(snippet.code).not.toContain('</script><script>alert')
    expect(snippet.code).toContain('animationData: {"t":"\\u003c/script>')
    expect(snippet.code).toContain('loop: false,')
    expect(snippet.code).toContain("renderer: 'canvas',")
    expect(snippet.preview).toContain(snippet.placeholder!)
    expect(snippet.preview.length).toBeLessThan(snippet.code.length + 20)
    // The escaped JSON is still the same data.
    const inline = snippet.code.match(/animationData: (.*),\n/)![1]
    expect(JSON.parse(inline)).toEqual(JSON.parse(json))
  })

  it('does not treat $ patterns in the JSON as replacement tokens', () => {
    const json = JSON.stringify({ text: "$& $' $`" })
    expect(buildEmbedSnippet(doc, opts({ inline: true }), 'x.html', json).code).toContain(json)
  })

  it('builds the dotLottie web component', () => {
    const { code } = buildEmbedSnippet(doc, opts({ flavor: 'wc', loop: false }), 'bounce.lottie')
    expect(code).toContain(`<script type="module" src="${DOTLOTTIE_WC_CDN}"></script>`)
    expect(code).toContain(
      '<dotlottie-wc src="bounce.lottie" autoplay style="width: 512px; height: 256px"></dotlottie-wc>',
    )
  })

  it('builds a React component for lottie-react 3', () => {
    const { code, install } = buildEmbedSnippet(
      doc,
      opts({ flavor: 'react', autoplay: false, renderer: 'canvas' }),
      'bounce.json',
    )
    expect(install).toBe('npm install lottie-react@3')
    expect(code).toContain("import { Lottie } from 'lottie-react'")
    expect(code).toContain("import animation from './bounce.json'")
    expect(code).toContain('export default function BouncingBall() {')
    // loop and autoplay default to off in lottie-react 3: only enabled ones are written.
    expect(code).toContain(
      '<Lottie src={animation} loop renderer="canvas" style={{ width: 512, height: 256 }} />',
    )
    const both = buildEmbedSnippet(doc, opts({ flavor: 'react' }), 'bounce.json').code
    expect(both).toContain(
      '<Lottie src={animation} loop autoplay style={{ width: 512, height: 256 }} />',
    )
    const neither = buildEmbedSnippet(
      doc,
      opts({ flavor: 'react', loop: false, autoplay: false }),
      '../a/b.json',
    ).code
    expect(neither).toContain("import animation from '../a/b.json'")
    expect(neither).toContain('<Lottie src={animation} style={{ width: 512, height: 256 }} />')
  })

  it('escapes attribute values', () => {
    const { code } = buildEmbedSnippet(doc, opts({ flavor: 'wc' }), 'a"b.lottie')
    expect(code).toContain('src="a&quot;b.lottie"')
    expect(buildEmbedSnippet(doc, opts(), "it's.json").code).toContain("path: 'it\\'s.json'")
  })

  it('names the needed file', () => {
    expect(embedFileExtension({ flavor: 'html', inline: false })).toBe('json')
    expect(embedFileExtension({ flavor: 'html', inline: true })).toBe('html')
    expect(embedFileExtension({ flavor: 'wc', inline: true })).toBe('lottie')
    expect(embedFileExtension({ flavor: 'react', inline: true })).toBe('json')
  })
})

describe('helpers', () => {
  it('derives component names', () => {
    expect(componentName('Bouncing ball')).toBe('BouncingBall')
    expect(componentName('ice-cream_29')).toBe('IceCream29')
    expect(componentName('Анимация')).toBe('LottieAnimation')
    expect(componentName('3d spin')).toBe('LottieAnimation')
    expect(componentName('Café déjà vu')).toBe('CafeDejaVu')
    expect(componentName(undefined)).toBe('LottieAnimation')
  })

  it('escapes script terminators', () => {
    expect(scriptSafeJson('"</script>"')).toBe('"\\u003c/script>"')
  })

  it('wraps a snippet into a page', () => {
    const page = standaloneHtml('A <b>title</b>', '<div></div>')
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<title>A &lt;b&gt;title&lt;/b&gt;</title>')
    expect(page).toContain('    <div></div>')
  })
})
