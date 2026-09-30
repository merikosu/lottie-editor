import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animation } from '@/lottie/types'

// In-memory idb-keyval: the storage module only needs these calls.
const db = new Map<IDBValidKey, unknown>()
let failNextWrite: Error | null = null
vi.mock('idb-keyval', () => ({
  createStore: () => 'store',
  get: async (key: IDBValidKey) => structuredClone(db.get(key)),
  getMany: async (keys: IDBValidKey[]) => keys.map((k) => structuredClone(db.get(k))),
  setMany: async (entries: [IDBValidKey, unknown][]) => {
    if (failNextWrite) {
      const e = failNextWrite
      failNextWrite = null
      throw e
    }
    for (const [k, v] of entries) db.set(k, structuredClone(v))
  },
  update: async (key: IDBValidKey, updater: (old: unknown) => unknown) => {
    db.set(key, structuredClone(updater(structuredClone(db.get(key)))))
  },
  delMany: async (keys: IDBValidKey[]) => {
    for (const k of keys) db.delete(k)
  },
  keys: async () => [...db.keys()],
}))
vi.stubGlobal('indexedDB', {})

const storage = await import('../storage')
const {
  MAX_RECENTS,
  StorageError,
  clearRecents,
  loadRecents,
  markExported,
  patchRecent,
  readDocument,
  readSession,
  removeRecent,
  writeDocument,
} = storage

function anim(nm: string): Animation {
  return { v: '5.7.4', fr: 30, ip: 0, op: 60, w: 100, h: 100, nm, layers: [] }
}

function write(
  id: string,
  opts: {
    at?: number
    contentKey?: string
    edited?: boolean
    session?: boolean
    original?: boolean
  } = {},
) {
  const at = opts.at ?? Date.now()
  return writeDocument({
    doc: {
      v: 1,
      id,
      doc: anim(id),
      meta: { fileName: `${id}.json`, format: 'json', loadedAt: at },
      savedAt: at,
      dirty: false,
      edited: opts.edited ?? false,
    },
    recent: {
      id,
      fileName: `${id}.json`,
      format: 'json',
      width: 100,
      height: 100,
      fps: 30,
      frames: 60,
      openedAt: at,
      edited: opts.edited ?? false,
      contentKey: opts.contentKey,
    },
    original: opts.original ? { value: anim(`${id}-original`), stored: false } : undefined,
    session: opts.session,
  })
}

describe('io storage', () => {
  beforeEach(() => {
    db.clear()
    failNextWrite = null
  })

  it('writes a document, its recent entry and the session', async () => {
    const recents = await write('a', { original: true })
    expect(recents.map((r) => r.id)).toEqual(['a'])
    expect(await readSession()).toMatchObject({ id: 'a' })
    const data = await readDocument('a')
    expect(data?.stored.doc.nm).toBe('a')
    expect(data?.original?.nm).toBe('a-original')
    expect(await readDocument('missing')).toBeNull()
  })

  it('keeps the newest first and merges updates without losing the thumbnail', async () => {
    await write('a', { at: 1000 })
    await write('b', { at: 2000 })
    await patchRecent('a', { thumbnail: 'data:image/png;base64,AAAA' })
    const recents = await write('a', { at: 3000 })
    expect(recents.map((r) => r.id)).toEqual(['a', 'b'])
    expect(recents[0].thumbnail).toBe('data:image/png;base64,AAAA')
  })

  it('replaces an unedited copy of the same content but keeps edited ones', async () => {
    await write('first', { at: 1000, contentKey: 'loader.json|123' })
    let recents = await write('second', { at: 2000, contentKey: 'loader.json|123' })
    expect(recents.map((r) => r.id)).toEqual(['second'])
    expect(await readDocument('first')).toBeNull()
    await write('second', { at: 2500, contentKey: 'loader.json|123', edited: true })
    recents = await write('third', { at: 3000, contentKey: 'loader.json|123' })
    expect(recents.map((r) => r.id)).toEqual(['third', 'second'])
  })

  it(`keeps at most ${MAX_RECENTS} files and deletes the dropped documents`, async () => {
    for (let i = 0; i < MAX_RECENTS + 3; i++) await write(`f${i}`, { at: 1000 + i })
    const recents = await loadRecents()
    expect(recents).toHaveLength(MAX_RECENTS)
    expect(recents[0].id).toBe(`f${MAX_RECENTS + 2}`)
    expect(await readDocument('f0')).toBeNull()
    expect(await readDocument(`f${MAX_RECENTS + 2}`)).not.toBeNull()
  })

  it('removes entries and clears everything but the open document', async () => {
    await write('a', { at: 1000 })
    await write('b', { at: 2000 })
    await write('c', { at: 3000 })
    expect((await removeRecent('b')).map((r) => r.id)).toEqual(['c', 'a'])
    expect(await readDocument('b')).toBeNull()
    expect((await clearRecents('c')).map((r) => r.id)).toEqual(['c'])
    expect(await readDocument('a')).toBeNull()
    expect(await readDocument('c')).not.toBeNull()
    expect(await readSession()).toMatchObject({ id: 'c' })
    await clearRecents()
    expect(await loadRecents()).toEqual([])
    expect(await readSession()).toBeNull()
  })

  it('writes the original once, and again if it went missing', async () => {
    await write('o', { original: true })
    const original = { value: anim('changed?'), stored: true }
    const base = (await readDocument('o'))!.stored
    await writeDocument({ doc: base, recent: (await loadRecents())[0], original })
    expect((await readDocument('o'))?.original?.nm).toBe('o-original')
    db.delete('orig:o')
    await writeDocument({ doc: base, recent: (await loadRecents())[0], original })
    expect((await readDocument('o'))?.original?.nm).toBe('changed?')
  })

  it('marks a downloaded recent file as exported', async () => {
    await write('d')
    await patchRecent('d', { dirty: true })
    db.set('doc:d', { ...(db.get('doc:d') as object), dirty: true })
    const recents = await markExported('d')
    expect(recents[0].dirty).toBe(false)
    expect((await readDocument('d'))?.stored.dirty).toBe(false)
    // Unknown ids are ignored.
    await expect(markExported('nope')).resolves.toHaveLength(1)
    expect(db.has('doc:nope')).toBe(false)
  })

  it('does not move the session when flushing a closing document', async () => {
    await write('open', { at: 1000 })
    await write('closing', { at: 2000, session: false })
    expect(await readSession()).toMatchObject({ id: 'open' })
  })

  it('stores the dotLottie container apart and re-attaches it', async () => {
    const container = {
      kind: 'dotlottie',
      animations: [{ id: 'other' }],
      extraFiles: { 'i/x.png': new Uint8Array([1, 2]) },
    }
    await writeDocument({
      doc: {
        v: 1,
        id: 'box',
        doc: anim('box'),
        meta: { fileName: 'b.lottie', format: 'lottie', loadedAt: 1 },
        savedAt: 1,
        dirty: false,
        edited: false,
      },
      recent: {
        id: 'box',
        fileName: 'b.lottie',
        format: 'lottie',
        width: 1,
        height: 1,
        fps: 30,
        frames: 1,
        openedAt: 1,
        edited: false,
      },
      container: { value: container, changed: true },
    })
    // A later write without the container keeps the stored one.
    await writeDocument({
      doc: {
        v: 1,
        id: 'box',
        doc: anim('box 2'),
        meta: { fileName: 'b.lottie', format: 'lottie', loadedAt: 1 },
        savedAt: 2,
        dirty: true,
        edited: true,
      },
      recent: {
        id: 'box',
        fileName: 'b.lottie',
        format: 'lottie',
        width: 1,
        height: 1,
        fps: 30,
        frames: 1,
        openedAt: 1,
        edited: true,
      },
    })
    const data = await readDocument('box')
    expect(data?.stored.doc.nm).toBe('box 2')
    expect(data?.stored.meta.dotLottie).toEqual(container)
    // Storage cleared behind our back: an unchanged container is written again.
    db.delete('box:box')
    await writeDocument({
      doc: {
        v: 1,
        id: 'box',
        doc: anim('box 3'),
        meta: { fileName: 'b.lottie', format: 'lottie', loadedAt: 1 },
        savedAt: 3,
        dirty: true,
        edited: true,
      },
      recent: {
        id: 'box',
        fileName: 'b.lottie',
        format: 'lottie',
        width: 1,
        height: 1,
        fps: 30,
        frames: 1,
        openedAt: 1,
        edited: true,
      },
      container: { value: container, changed: false },
    })
    expect((await readDocument('box'))?.stored.meta.dotLottie).toEqual(container)
    await removeRecent('box')
    expect(db.has('box:box')).toBe(false)
  })

  it('reports quota errors as such', async () => {
    failNextWrite = Object.assign(new Error('The quota has been exceeded.'), {
      name: 'QuotaExceededError',
    })
    await expect(write('a')).rejects.toMatchObject({ reason: 'quota' })
    failNextWrite = new Error('Connection lost')
    await expect(write('a')).rejects.toBeInstanceOf(StorageError)
  })

  it('ignores malformed stored data', async () => {
    db.set('recents', [{ id: 1 }, null, { id: 'ok', fileName: 'ok.json', openedAt: 1 }])
    expect((await loadRecents()).map((r) => r.id)).toEqual(['ok'])
    db.set('session', 'garbage')
    expect(await readSession()).toBeNull()
    db.set('doc:x', { v: 2 })
    expect(await readDocument('x')).toBeNull()
  })
})
