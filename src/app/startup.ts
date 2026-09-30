/**
 * Startup documents from the URL:
 *  - `?sample=<id>` loads a built-in sample (e2e tests, screenshots, demo links)
 *  - `?url=<address>` fetches a Lottie file (.json / .lottie / .tgs) and opens it
 *
 * Files are routed through the file handler registry (the io feature parses every format);
 * plain JSON falls back to a direct load so the parameter works even without handlers.
 * Other startup behaviour (autosave restore) belongs to the io feature, which must skip it
 * when `hasStartupDocument()` is true.
 */
import { dispatchFiles } from '@/commands/files'
import { fromObject } from '@/lottie/document'
import { loadDocument } from '@/store/document'
import { findSample } from '@/samples'

function params(): URLSearchParams {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
}

export function startupSampleId(): string | null {
  return params().get('sample')
}

export function startupUrl(): string | null {
  return params().get('url')
}

export function hasStartupDocument(): boolean {
  return startupSampleId() !== null || startupUrl() !== null
}

/** @deprecated use hasStartupDocument */
export const hasStartupSample = hasStartupDocument

/** The link's server answered with an error status. */
export class LinkHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

/** Why the `?url=` link did not open, if it did not (shown by the app shell, see App.tsx). */
let linkFailure: { url: string; error: unknown } | null = null

export function startupLinkFailure(): { url: string; error: unknown } | null {
  return linkFailure
}

async function loadFromUrl(url: string): Promise<boolean> {
  const res = await fetch(url)
  if (!res.ok) throw new LinkHttpError(res.status)
  const blob = await res.blob()
  const name = decodeURIComponent(
    new URL(url, location.href).pathname.split('/').pop() || 'animation.json',
  )
  if (await dispatchFiles([new File([blob], name, { type: blob.type })])) return true
  const { animation } = fromObject(JSON.parse(await blob.text()))
  loadDocument(animation, { fileName: name, format: 'json', sourceSize: blob.size })
  return true
}

let startupPromise: Promise<boolean> | null = null

/** Loads the startup document once (safe to call repeatedly, e.g. under React StrictMode). */
export function loadStartupDocument(): Promise<boolean> {
  startupPromise ??= loadStartupDocumentOnce()
  return startupPromise
}

async function loadStartupDocumentOnce(): Promise<boolean> {
  const id = startupSampleId()
  if (id) {
    const sample = findSample(id)
    if (!sample) return false
    const doc = await sample.load()
    loadDocument(doc, { fileName: `${sample.id}.json`, format: 'json' })
    return true
  }
  const url = startupUrl()
  if (url) {
    try {
      return await loadFromUrl(url)
    } catch (err) {
      console.error('Could not open the file from ?url=', err)
      linkFailure = { url, error: err }
      return false
    }
  }
  return false
}
