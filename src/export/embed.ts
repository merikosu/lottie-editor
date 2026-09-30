/**
 * Embed code for developers: ready-to-paste snippets that play the animation on a web page
 * (lottie-web from a CDN), with the dotLottie web component, or in React (lottie-react 3: named
 * `Lottie` export, `src` prop, loop and autoplay off unless set).
 *
 * The snippets reference the animation file by name (the user hosts it next to the page), or,
 * for plain HTML, can carry the JSON inline. Inline JSON is escaped so that text inside the
 * animation can never close the <script> element.
 */
import type { Animation } from '@/lottie/types'

export type EmbedFlavor = 'html' | 'wc' | 'react'

export interface EmbedOptions {
  flavor: EmbedFlavor
  loop: boolean
  autoplay: boolean
  renderer: 'svg' | 'canvas'
  /** HTML only: put the JSON inside the snippet instead of loading a file. */
  inline: boolean
}

export const LOTTIE_WEB_VERSION = '5.13.0'
export const LOTTIE_WEB_CDN = `https://cdn.jsdelivr.net/npm/lottie-web@${LOTTIE_WEB_VERSION}/build/player/lottie.min.js`
export const DOTLOTTIE_WC_VERSION = '0.9.28'
export const DOTLOTTIE_WC_CDN = `https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-wc@${DOTLOTTIE_WC_VERSION}/dist/dotlottie-wc.js`
/** The React snippet is written for this major version of lottie-react. */
export const LOTTIE_REACT_MAJOR = 3

/** Inline JSON above this size makes pages heavy and uncacheable: the UI warns about it. */
export const INLINE_WARN_BYTES = 100 * 1024

/** Whether the snippet embeds the JSON (only plain HTML can). */
export function isInline(opts: Pick<EmbedOptions, 'flavor' | 'inline'>): boolean {
  return opts.flavor === 'html' && opts.inline
}

/** Extension of the file the snippet needs next to it (or the page itself when inline). */
export function embedFileExtension(
  opts: Pick<EmbedOptions, 'flavor' | 'inline'>,
): 'json' | 'lottie' | 'html' {
  if (opts.flavor === 'wc') return 'lottie'
  return isInline(opts) ? 'html' : 'json'
}

/**
 * JSON that is safe inside an inline <script>: `<` is escaped (no `</script>` can appear), and
 * the two line separators that were not valid in old JavaScript strings are escaped too.
 */
export function scriptSafeJson(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** JavaScript string literal with single quotes. */
function jsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/**
 * React component name from the animation name: "Bouncing ball" → "BouncingBall". Names
 * without Latin letters or digits fall back to "LottieAnimation".
 */
export function componentName(name: string | undefined): string {
  const words = (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
  const joined = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  if (!joined || /^[0-9]/.test(joined)) return 'LottieAnimation'
  return joined.length > 48 ? joined.slice(0, 48) : joined
}

function sizeStyle(doc: Pick<Animation, 'w' | 'h'>): { width: number; height: number } {
  const width = Math.max(1, Math.round(doc.w || 512))
  const height = Math.max(1, Math.round(doc.h || 512))
  return { width, height }
}

export interface EmbedSnippet {
  /** The code to copy. */
  code: string
  /**
   * For display: the code with the inline JSON replaced by `placeholder` (the full JSON can be
   * megabytes; the code view shows where it goes and how big it is).
   */
  preview: string
  /** The placeholder used in `preview` (null when nothing is collapsed). */
  placeholder: string | null
  /** Command to install the package (React), if any. */
  install: string | null
}

/**
 * Builds the snippet. `assetName` is the file the snippet loads (e.g. "bounce.json"); `json` is
 * the minified animation (only needed for inline HTML).
 */
export function buildEmbedSnippet(
  doc: Pick<Animation, 'w' | 'h' | 'nm'>,
  opts: EmbedOptions,
  assetName: string,
  json = '',
): EmbedSnippet {
  const { width, height } = sizeStyle(doc)
  if (opts.flavor === 'wc') {
    const attrs = [`src="${escapeAttr(assetName)}"`]
    if (opts.autoplay) attrs.push('autoplay')
    if (opts.loop) attrs.push('loop')
    attrs.push(`style="width: ${width}px; height: ${height}px"`)
    const code = [
      `<script type="module" src="${DOTLOTTIE_WC_CDN}"></script>`,
      `<dotlottie-wc ${attrs.join(' ')}></dotlottie-wc>`,
    ].join('\n')
    return { code, preview: code, placeholder: null, install: null }
  }

  if (opts.flavor === 'react') {
    const name = componentName(doc.nm)
    // lottie-react 3 plays once and waits unless told otherwise: only "on" needs a prop.
    const props = ['src={animation}']
    if (opts.loop) props.push('loop')
    if (opts.autoplay) props.push('autoplay')
    if (opts.renderer === 'canvas') props.push('renderer="canvas"')
    props.push(`style={{ width: ${width}, height: ${height} }}`)
    const importPath = /^(\.{1,2}\/|\/)/.test(assetName) ? assetName : `./${assetName}`
    const code = [
      "import { Lottie } from 'lottie-react'",
      `import animation from ${jsString(importPath)}`,
      '',
      `export default function ${name}() {`,
      `  return <Lottie ${props.join(' ')} />`,
      '}',
    ].join('\n')
    return {
      code,
      preview: code,
      placeholder: null,
      install: `npm install lottie-react@${LOTTIE_REACT_MAJOR}`,
    }
  }

  const inline = isInline(opts)
  const PLACEHOLDER = '__LOTTIE_JSON__'
  const source = inline ? `animationData: ${PLACEHOLDER},` : `path: ${jsString(assetName)},`
  const template = [
    `<div id="lottie" style="width: ${width}px; height: ${height}px"></div>`,
    `<script src="${LOTTIE_WEB_CDN}"></script>`,
    '<script>',
    '  lottie.loadAnimation({',
    "    container: document.getElementById('lottie'),",
    `    renderer: '${opts.renderer}',`,
    `    loop: ${opts.loop},`,
    `    autoplay: ${opts.autoplay},`,
    `    ${source}`,
    '  })',
    '</script>',
  ].join('\n')
  if (!inline) return { code: template, preview: template, placeholder: null, install: null }
  return {
    code: template.replace(PLACEHOLDER, () => scriptSafeJson(json)),
    preview: template,
    placeholder: PLACEHOLDER,
    install: null,
  }
}

/** A complete web page around an HTML snippet (the "download .html" option of inline embeds). */
export function standaloneHtml(title: string, snippet: string): string {
  const body = snippet
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n')
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${escapeHtml(title || 'Animation')}</title>`,
    '    <style>',
    '      html, body { height: 100%; margin: 0; }',
    '      body { display: grid; place-items: center; }',
    '      #lottie { max-width: 100%; }',
    '    </style>',
    '  </head>',
    '  <body>',
    body,
    '  </body>',
    '</html>',
    '',
  ].join('\n')
}
