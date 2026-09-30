/**
 * Renaming the open document from the top bar. The extension says what the file is (⌘S writes
 * the document in its own format whatever the name), so renaming changes the name only: the
 * editable part is the stem, and the original extension is kept.
 */

/** Extensions the editor opens; a name ending in one of them names the format. */
const DOCUMENT_EXTENSIONS = /\.(json|lottie|tgs|zip)$/i

/** The extension of a document file name, with its dot (".json"), or "" when it has none. */
export function documentExtension(fileName: string): string {
  return DOCUMENT_EXTENSIONS.exec(fileName)?.[0] ?? ''
}

/** Length of the part of `fileName` a rename starts with selected (the name without extension). */
export function stemLength(fileName: string): number {
  return fileName.length - documentExtension(fileName).length
}

/**
 * The file name after the user typed `typed` for `original`: trimmed, with the original
 * extension kept (typing "logo" for "intro.json" gives "logo.json"; "logo.lottie" for a JSON
 * document still gives "logo.json", since renaming does not convert it). Null when nothing
 * usable was typed.
 */
export function renamedFileName(original: string, typed: string): string | null {
  const name = typed.trim()
  if (!name) return null
  const extension = documentExtension(original)
  if (!extension) return name
  const stem = name.slice(0, name.length - documentExtension(name).length).trim()
  if (!stem) return null
  return `${stem}${extension}`
}
