/**
 * Transient UI state of the Assets panel (not part of the document or its history).
 */
import { create } from 'zustand'

export type AssetKind = 'image' | 'comp' | 'font'

/** An asset row: images and precomps by asset id, fonts by `fName`. */
export interface AssetKey {
  kind: AssetKind
  id: string
}

interface AssetsUi {
  selected: AssetKey | null
  /** Row being renamed inline (`field` says which property is edited). */
  renaming: (AssetKey & { field: 'id' | 'name' }) | null
  /** Font whose editor popover is open ('' = a new font). */
  editingFont: string | null
  filter: string
  /** Image row currently under a file drag. */
  dragOver: string | null
}

export const useAssetsUi = create<AssetsUi>()(() => ({
  selected: null,
  renaming: null,
  editingFont: null,
  filter: '',
  dragOver: null,
}))

export function sameKey(a: AssetKey | null | undefined, b: AssetKey | null | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id
}

export function selectAsset(key: AssetKey | null): void {
  useAssetsUi.setState((s) =>
    sameKey(s.selected, key) || (!s.selected && !key) ? s : { selected: key },
  )
}

export function startRename(key: AssetKey, field: 'id' | 'name'): void {
  useAssetsUi.setState({ renaming: { ...key, field }, selected: key })
}

export function stopRename(): void {
  useAssetsUi.setState({ renaming: null })
}

export function editFont(fName: string | null): void {
  useAssetsUi.setState({ editingFont: fName })
}

export function setAssetFilter(filter: string): void {
  useAssetsUi.setState({ filter })
}

export function setDragOver(id: string | null): void {
  useAssetsUi.setState((s) => (s.dragOver === id ? s : { dragOver: id }))
}

/** Clears per-document state when another document is opened. */
export function resetAssetsUi(): void {
  useAssetsUi.setState({ selected: null, renaming: null, editingFont: null, dragOver: null })
}
