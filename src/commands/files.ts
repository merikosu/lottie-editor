/**
 * File handler registry. Files arriving from drag & drop, the Open dialog or paste are
 * dispatched here; the first handler that returns true consumes them.
 *  - io: Lottie JSON / .lottie / .tgs / .zip → open as document
 *  - assets: images → replace the selected image asset or add an image layer
 */
export type FileHandler = (files: File[]) => boolean | Promise<boolean>

interface Entry {
  priority: number
  handler: FileHandler
}

const handlers: Entry[] = []

export function registerFileHandler(handler: FileHandler, priority = 0): () => void {
  const entry = { handler, priority }
  handlers.push(entry)
  handlers.sort((a, b) => b.priority - a.priority)
  return () => {
    const i = handlers.indexOf(entry)
    if (i >= 0) handlers.splice(i, 1)
  }
}

/** Dispatches files to the registered handlers. Returns true if one consumed them. */
export async function dispatchFiles(files: File[]): Promise<boolean> {
  if (!files.length) return false
  for (const { handler } of handlers.slice()) {
    try {
      if (await handler(files)) return true
    } catch (err) {
      console.error('File handler failed', err)
    }
  }
  return false
}
