/**
 * Single global `paste` listener with a handler registry. Features register handlers for
 * the content they understand (files, full Lottie JSON, copied layers, copied keyframes);
 * the first handler returning true consumes the event.
 *
 * Copy formats written by the editor are JSON objects with a `__lottieEditor` marker:
 *   { "__lottieEditor": "layers", ... } / { "__lottieEditor": "keyframes", ... }
 */
import { isEditableTarget } from '@/lib/platform'
import { dispatchFiles } from './files'

export interface PasteData {
  /** Plain text from the clipboard (may be empty). */
  text: string
  /** Parsed JSON when the text is valid JSON, otherwise undefined. */
  json: unknown
  files: File[]
  event: ClipboardEvent | null
}

export type PasteHandler = (data: PasteData) => boolean | Promise<boolean>

interface Entry {
  priority: number
  handler: PasteHandler
}

const handlers: Entry[] = []

/** Registers a paste handler; higher priority runs first. Returns an unregister function. */
export function registerPasteHandler(handler: PasteHandler, priority = 0): () => void {
  const entry = { handler, priority }
  handlers.push(entry)
  handlers.sort((a, b) => b.priority - a.priority)
  return () => {
    const i = handlers.indexOf(entry)
    if (i >= 0) handlers.splice(i, 1)
  }
}

function parseJson(text: string): unknown {
  const t = text.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

/**
 * Runs handlers for the given clipboard content. Returns true if one consumed it.
 * Pasted files are forwarded to the file handler registry (see files.ts).
 */
export async function dispatchPaste(
  text: string,
  files: File[],
  event: ClipboardEvent | null,
): Promise<boolean> {
  if (files.length && (await dispatchFiles(files))) return true
  const data: PasteData = { text, json: parseJson(text), files, event }
  for (const { handler } of handlers.slice()) {
    try {
      if (await handler(data)) return true
    } catch (err) {
      console.error('Paste handler failed', err)
    }
  }
  return false
}

/** Reads the system clipboard (menu "Paste"); may prompt for permission. */
export async function pasteFromClipboard(): Promise<boolean> {
  try {
    const text = await navigator.clipboard.readText()
    return dispatchPaste(text, [], null)
  } catch {
    return false
  }
}

/** Marker used in JSON copied by the editor. */
export const CLIPBOARD_MARKER = '__lottieEditor'

export function isEditorClipboard(json: unknown, kind: string): json is Record<string, unknown> {
  return (
    !!json &&
    typeof json === 'object' &&
    (json as Record<string, unknown>)[CLIPBOARD_MARKER] === kind
  )
}

function onPaste(e: ClipboardEvent) {
  if (isEditableTarget(e.target)) return
  const dt = e.clipboardData
  if (!dt) return
  const files = Array.from(dt.files ?? [])
  const text = dt.getData('text/plain') ?? ''
  if (!files.length && !text) return
  e.preventDefault()
  void dispatchPaste(text, files, e)
}

export function installPasteHandler(): () => void {
  window.addEventListener('paste', onPaste)
  return () => window.removeEventListener('paste', onPaste)
}
