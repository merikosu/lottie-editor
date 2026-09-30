import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FetchFileError,
  fetchFile,
  fileNameFromResponse,
  looksLikeImageUrl,
  normalizeUrl,
} from '../fetchUrl'

describe('normalizeUrl', () => {
  it('accepts http(s) links and bare hosts', () => {
    expect(normalizeUrl(' https://lottie.host/a/b.json ')).toEqual({
      url: 'https://lottie.host/a/b.json',
      rewritten: false,
    })
    expect(normalizeUrl('lottie.host/a/b.json')).toEqual({
      url: 'https://lottie.host/a/b.json',
      rewritten: false,
    })
    expect(normalizeUrl('http://localhost:5173/x.json')?.url).toBe('http://localhost:5173/x.json')
  })

  it('reads "host:port" as a host, not as a URL scheme', () => {
    // Local servers are reached over http; everything else defaults to https.
    expect(normalizeUrl('localhost:5173/x.json')?.url).toBe('http://localhost:5173/x.json')
    expect(normalizeUrl('localhost/x.json')?.url).toBe('http://localhost/x.json')
    expect(normalizeUrl('127.0.0.1:8080/a.lottie')?.url).toBe('http://127.0.0.1:8080/a.lottie')
    expect(normalizeUrl('example.com:8443/a.json')?.url).toBe('https://example.com:8443/a.json')
    expect(normalizeUrl('cdn.example.com')?.url).toBe('https://cdn.example.com/')
  })

  it('rejects everything else', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('not a url')).toBeNull()
    expect(normalizeUrl('ftp://example.com/a.json')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('file:///Users/me/a.json')).toBeNull()
    expect(normalizeUrl('{"layers":[]}')).toBeNull()
  })

  it('turns GitHub file pages into raw file links', () => {
    expect(normalizeUrl('https://github.com/acme/anims/blob/main/src/loader.json')).toEqual({
      url: 'https://raw.githubusercontent.com/acme/anims/main/src/loader.json',
      rewritten: true,
    })
  })

  it('recognizes image links', () => {
    expect(looksLikeImageUrl('https://x.com/a/logo.PNG')).toBe(true)
    expect(looksLikeImageUrl('https://x.com/a/anim.json')).toBe(false)
    expect(looksLikeImageUrl('nope')).toBe(false)
  })
})

describe('fileNameFromResponse', () => {
  it('prefers Content-Disposition, then the path', () => {
    expect(
      fileNameFromResponse('https://x.com/dl?id=1', 'attachment; filename="loader.lottie"', null),
    ).toBe('loader.lottie')
    expect(
      fileNameFromResponse(
        'https://x.com/dl',
        "attachment; filename*=UTF-8''%D0%BB%D0%B0%D0%B9%D0%BA.json",
        null,
      ),
    ).toBe('лайк.json')
    expect(fileNameFromResponse('https://x.com/files/My%20Anim.json?v=2', null, null)).toBe(
      'My Anim.json',
    )
  })

  it('adds an extension from the content type', () => {
    expect(
      fileNameFromResponse('https://lottie.host/abc', null, 'application/json; charset=utf-8'),
    ).toBe('abc.json')
    expect(fileNameFromResponse('https://x.com/', null, 'application/zip')).toBe('animation.lottie')
    expect(fileNameFromResponse('https://x.com/s', null, 'application/gzip')).toBe('s.tgs')
  })
})

describe('fetchFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads with progress and names the file', async () => {
    const body = new TextEncoder().encode('{"layers":[]}')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
          }),
      ),
    )
    const progress: number[] = []
    const file = await fetchFile('https://example.com/anim', {
      onProgress: (p) => progress.push(p.loaded),
    })
    expect(file.name).toBe('anim.json')
    expect(file.size).toBe(body.length)
    expect(progress[progress.length - 1]).toBe(body.length)
  })

  it('classifies failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404, statusText: 'Not Found' })),
    )
    await expect(fetchFile('https://example.com/a.json')).rejects.toMatchObject({
      code: 'http',
      status: 404,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(fetchFile('https://example.com/a.json')).rejects.toBeInstanceOf(FetchFileError)
    await expect(fetchFile('https://example.com/a.json')).rejects.toMatchObject({ code: 'network' })
  })

  it('refuses huge downloads early', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('x', { status: 200, headers: { 'content-length': String(2 ** 31) } }),
      ),
    )
    await expect(fetchFile('https://example.com/a.json')).rejects.toMatchObject({
      code: 'too-large',
    })
  })
})
