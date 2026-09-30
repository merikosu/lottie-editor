/**
 * Downloading animations from a link (the "Open from URL" dialog and pasted links).
 */
import { fileExtension } from '@/lottie/formats'

export type FetchErrorCode = 'invalid-url' | 'network' | 'http' | 'too-large'

/** Download failure, classified for a helpful message (network/CORS, HTTP status, size). */
export class FetchFileError extends Error {
  readonly code: FetchErrorCode
  readonly status?: number
  readonly statusText?: string
  constructor(
    code: FetchErrorCode,
    message: string,
    extra: { status?: number; statusText?: string } = {},
  ) {
    super(message)
    this.name = 'FetchFileError'
    this.code = code
    this.status = extra.status
    this.statusText = extra.statusText
  }
}

/** Larger downloads are refused (a browser tab would struggle with the JSON anyway). */
export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024

export interface NormalizedUrl {
  url: string
  /** A GitHub page link was turned into its raw file link. */
  rewritten: boolean
}

/** Hosts reached over plain http when typed without a scheme (local dev servers). */
const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?(\/|$)/i
/** A host name with an optional port and path: "lottie.host/x.json", "example.com:8080/x". */
const BARE_HOST = /^([\w-]+(\.[\w-]+)+)(:\d+)?(\/|$)/i

/**
 * Validates a typed/pasted link. Adds a scheme to bare hosts ("lottie.host/x.json" → https,
 * "localhost:5173/x.json" → http) and turns GitHub file pages into raw file links
 * (raw.githubusercontent.com allows cross-site loading). Returns null for anything that is not
 * an http(s) link.
 */
export function normalizeUrl(input: string): NormalizedUrl | null {
  let text = input.trim()
  if (!text || /\s/.test(text)) return null
  // "host:port/…" looks like a scheme to the URL parser, so bare hosts are recognized first.
  if (LOCAL_HOST.test(text)) text = `http://${text}`
  else if (BARE_HOST.test(text)) text = `https://${text}`
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const github = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname)
  if (url.hostname === 'github.com' && github) {
    return {
      url: `https://raw.githubusercontent.com/${github[1]}/${github[2]}/${github[3]}`,
      rewritten: true,
    }
  }
  return { url: url.href, rewritten: false }
}

/** True for links that most likely point at an image (left to other paste handlers). */
export function looksLikeImageUrl(url: string): boolean {
  try {
    return /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** File name from Content-Disposition, else the last path segment. */
export function fileNameFromResponse(
  url: string,
  disposition: string | null,
  contentType: string | null,
): string {
  let name = ''
  if (disposition) {
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)
    const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition)
    try {
      name = star ? decodeURIComponent(star[1].trim()) : (plain?.[1].trim() ?? '')
    } catch {
      name = plain?.[1].trim() ?? ''
    }
  }
  if (!name) {
    try {
      const segments = new URL(url).pathname.split('/').filter(Boolean)
      name = decodeURIComponent(segments[segments.length - 1] ?? '')
    } catch {
      name = ''
    }
  }
  name = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'animation'
  if (!fileExtension(name)) {
    const type = (contentType ?? '').toLowerCase()
    // gzip before zip: "application/gzip" contains "zip".
    if (type.includes('json')) name += '.json'
    else if (type.includes('gzip')) name += '.tgs'
    else if (type.includes('zip') || type.includes('dotlottie')) name += '.lottie'
  }
  return name
}

export interface FetchProgress {
  loaded: number
  /** Total bytes when the server sent a length. */
  total: number | null
}

/**
 * Downloads a file with progress. Rejects with FetchFileError (network/CORS, HTTP status, too
 * large) or an AbortError when `signal` fires.
 */
export async function fetchFile(
  url: string,
  opts: { signal?: AbortSignal; onProgress?: (p: FetchProgress) => void } = {},
): Promise<File> {
  let res: Response
  try {
    res = await fetch(url, { signal: opts.signal, credentials: 'omit', redirect: 'follow' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    // Browsers report CORS refusals and unreachable hosts the same way.
    throw new FetchFileError('network', e instanceof Error ? e.message : 'Network error')
  }
  if (!res.ok)
    throw new FetchFileError('http', `HTTP ${res.status}`, {
      status: res.status,
      statusText: res.statusText,
    })
  const lengthHeader = Number(res.headers.get('content-length'))
  // Content-Length is the compressed size when the response is encoded: only trust it as a hint.
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null
  if (total && total > MAX_DOWNLOAD_BYTES) throw new FetchFileError('too-large', 'File too large')
  const chunks: Uint8Array[] = []
  let loaded = 0
  opts.onProgress?.({ loaded, total })
  if (res.body) {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      if (loaded > MAX_DOWNLOAD_BYTES) {
        await reader.cancel()
        throw new FetchFileError('too-large', 'File too large')
      }
      opts.onProgress?.({ loaded, total: total && total >= loaded ? total : null })
    }
  } else {
    const buffer = new Uint8Array(await res.arrayBuffer())
    chunks.push(buffer)
    loaded = buffer.length
  }
  const type = res.headers.get('content-type') ?? ''
  const name = fileNameFromResponse(res.url || url, res.headers.get('content-disposition'), type)
  return new File(chunks as BlobPart[], name, { type: type.split(';')[0] })
}
