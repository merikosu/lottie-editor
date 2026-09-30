/** Triggers a browser download for a Blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke later: Safari needs the URL to stay alive until the download starts.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadText(text: string, fileName: string, mime = 'application/json'): void {
  downloadBlob(new Blob([text], { type: mime }), fileName)
}

/** Replaces the extension of a file name: ("loader.json", "gif") → "loader.gif". */
export function withExtension(fileName: string, ext: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'animation'
  return `${base}.${ext.replace(/^\./, '')}`
}

/** Removes characters that are invalid in file names on common platforms. */
export function sanitizeFileName(name: string, fallback = 'animation'): string {
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim()
  return cleaned || fallback
}
