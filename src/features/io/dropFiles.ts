/**
 * Reading the files of a drop, including the contents of dropped folders.
 */
import { setRelativePath } from './open'

/** Folder drops are capped (a dropped home folder should not freeze the tab). */
const MAX_FOLDER_FILES = 500

async function readEntry(
  entry: FileSystemEntry,
  prefix: string,
  budget: { left: number },
): Promise<File[]> {
  if (budget.left <= 0 || entry.name.startsWith('.') || entry.name === '__MACOSX') return []
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    )
    budget.left--
    setRelativePath(file, `${prefix}${file.name}`)
    return [file]
  }
  if (!entry.isDirectory) return []
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const children: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (!batch.length || children.length > MAX_FOLDER_FILES) break
    children.push(...batch)
  }
  const nested: File[] = []
  for (const child of children)
    nested.push(...(await readEntry(child, `${prefix}${entry.name}/`, budget)))
  return nested
}

/**
 * Files of a drop, including the contents of dropped folders (a Bodymovin export folder with
 * `data.json` and `images/`). Must be called synchronously inside the drop event: the browser
 * empties the DataTransfer once the event is over.
 */
export function collectFiles(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file')
  const entries = items.map((i) =>
    typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null,
  )
  const files = Array.from(dt.files)
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve(files)
  const budget = { left: MAX_FOLDER_FILES }
  return Promise.all(
    entries.map((entry, i) =>
      entry
        ? readEntry(entry, '', budget).catch(() => [])
        : Promise.resolve(files[i] ? [files[i]] : []),
    ),
  ).then((lists) => lists.flat())
}
