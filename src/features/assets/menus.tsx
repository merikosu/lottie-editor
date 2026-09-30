/**
 * Menu items of asset rows, shared by each row's "…" button and the list's context menu.
 */
import {
  Copy,
  Download,
  FileJson,
  FolderOpen,
  Hash,
  ImageDown,
  Pencil,
  Replace,
  SquareMousePointer,
  Trash2,
} from 'lucide-react'
import { MenuItem, MenuSeparator, type MenuKind } from '@/components/ui'
import type { Dict } from '@/i18n'
import { fontUsage, imageUsage, precompUsage, type ImageStatus } from '@/lottie/assets'
import { getDoc, selectNodes } from '@/store/document'
import {
  chooseReplacement,
  copyToClipboard,
  deleteAsset,
  downloadImage,
  embedLinkedImage,
  locateImage,
  removeFontEntry,
  selectLayers,
  showInJson,
} from './actions'
import { editFont, selectAsset, startRename } from './store'

/** Current users of an asset, read at action time (rows only receive counts). */
export function usersOf(kind: 'image' | 'comp' | 'font', id: string) {
  const doc = getDoc()
  if (!doc) return []
  const map =
    kind === 'image' ? imageUsage(doc) : kind === 'comp' ? precompUsage(doc) : fontUsage(doc)
  return map.get(id) ?? []
}

function assetPath(id: string): (string | number)[] | null {
  const index = getDoc()?.assets?.findIndex((a) => a.id === id) ?? -1
  return index >= 0 ? ['assets', index] : null
}

/* ------------------------------- Menu items ------------------------------- */

export interface ImageMenuData {
  id: string
  status: ImageStatus
  userCount: number
  reachable: boolean
}

/** Items of an image's "…" and context menus. */
export function imageMenu(t: Dict, kind: MenuKind, d: ImageMenuData) {
  const used = d.userCount > 0
  return (
    <>
      {d.status === 'missing' ? (
        <MenuItem kind={kind} icon={FolderOpen} onSelect={() => void locateImage(d.id)}>
          {t.assets.actions.locate}
        </MenuItem>
      ) : (
        <MenuItem kind={kind} icon={Replace} onSelect={() => void chooseReplacement(d.id)}>
          {t.assets.actions.replace}
        </MenuItem>
      )}
      {d.status === 'linked' && (
        <MenuItem kind={kind} icon={ImageDown} onSelect={() => void embedLinkedImage(d.id)}>
          {t.assets.actions.embed}
        </MenuItem>
      )}
      <MenuItem
        kind={kind}
        icon={Download}
        disabled={d.status === 'missing'}
        onSelect={() => void downloadImage(d.id)}
      >
        {t.assets.actions.download}
      </MenuItem>
      <MenuSeparator kind={kind} />
      <MenuItem
        kind={kind}
        icon={SquareMousePointer}
        disabled={!used}
        onSelect={() => selectLayers(usersOf('image', d.id))}
      >
        {t.assets.actions.selectLayers(d.userCount)}
      </MenuItem>
      <MenuItem
        kind={kind}
        icon={FileJson}
        onSelect={() => showInJson(assetPath(d.id) ?? ['assets'])}
      >
        {t.assets.actions.showInJson}
      </MenuItem>
      <MenuItem
        kind={kind}
        icon={Pencil}
        shortcut="f2"
        onSelect={() => startRename({ kind: 'image', id: d.id }, 'name')}
      >
        {t.assets.actions.rename}
      </MenuItem>
      <MenuItem
        kind={kind}
        icon={Hash}
        onSelect={() => startRename({ kind: 'image', id: d.id }, 'id')}
      >
        {t.assets.actions.renameId}
      </MenuItem>
      <MenuItem kind={kind} icon={Copy} onSelect={() => copyToClipboard(d.id)}>
        {t.assets.actions.copyId}
      </MenuItem>
      <MenuSeparator kind={kind} />
      <MenuItem
        kind={kind}
        icon={Trash2}
        danger
        disabled={used && d.reachable}
        shortcut="delete"
        onSelect={() => deleteAsset(d.id)}
      >
        {t.assets.actions.delete}
      </MenuItem>
    </>
  )
}

export interface CompositionMenuData {
  id: string
  userCount: number
  reachable: boolean
}

export function compositionMenu(t: Dict, kind: MenuKind, d: CompositionMenuData) {
  const used = d.userCount > 0
  const key = { kind: 'comp' as const, id: d.id }
  return (
    <>
      <MenuItem kind={kind} icon={Pencil} shortcut="f2" onSelect={() => startRename(key, 'name')}>
        {t.assets.actions.rename}
      </MenuItem>
      <MenuItem kind={kind} icon={Hash} onSelect={() => startRename(key, 'id')}>
        {t.assets.actions.renameId}
      </MenuItem>
      <MenuItem kind={kind} icon={Copy} onSelect={() => copyToClipboard(d.id)}>
        {t.assets.actions.copyId}
      </MenuItem>
      <MenuSeparator kind={kind} />
      <MenuItem
        kind={kind}
        icon={SquareMousePointer}
        disabled={!used}
        onSelect={() => selectLayers(usersOf('comp', d.id))}
      >
        {t.assets.actions.selectLayers(d.userCount)}
      </MenuItem>
      <MenuItem
        kind={kind}
        icon={FileJson}
        onSelect={() => showInJson(assetPath(d.id) ?? ['assets'])}
      >
        {t.assets.actions.showInJson}
      </MenuItem>
      <MenuSeparator kind={kind} />
      <MenuItem
        kind={kind}
        icon={Trash2}
        danger
        disabled={used && d.reachable}
        shortcut="delete"
        onSelect={() => deleteAsset(d.id)}
      >
        {t.assets.actions.delete}
      </MenuItem>
    </>
  )
}

export interface FontMenuData {
  fName: string
  userCount: number
}

export function fontMenu(t: Dict, kind: MenuKind, d: FontMenuData) {
  const used = d.userCount > 0
  return (
    <>
      <MenuItem kind={kind} icon={Pencil} onSelect={() => editFont(d.fName)}>
        {t.assets.actions.edit}
      </MenuItem>
      <MenuItem kind={kind} icon={Copy} onSelect={() => copyToClipboard(d.fName)}>
        {t.assets.actions.copyName}
      </MenuItem>
      <MenuSeparator kind={kind} />
      <MenuItem
        kind={kind}
        icon={SquareMousePointer}
        disabled={!used}
        onSelect={() => selectLayers(usersOf('font', d.fName))}
      >
        {t.assets.actions.selectLayers(d.userCount)}
      </MenuItem>
      <MenuItem
        kind={kind}
        icon={FileJson}
        onSelect={() => {
          const index = getDoc()?.fonts?.list?.findIndex((f) => f.fName === d.fName) ?? -1
          if (index >= 0) showInJson(['fonts', 'list', index])
        }}
      >
        {t.assets.actions.showInJson}
      </MenuItem>
      <MenuSeparator kind={kind} />
      <MenuItem
        kind={kind}
        icon={Trash2}
        danger
        disabled={used}
        shortcut="delete"
        onSelect={() => removeFontEntry(d.fName)}
      >
        {t.assets.actions.delete}
      </MenuItem>
    </>
  )
}

/** Selects a precomp and its first instance layer (so the canvas and timeline show it). */
export function selectComposition(id: string): void {
  selectAsset({ kind: 'comp', id })
  const first = usersOf('comp', id)[0]
  // Shows the instance in the inspector and on the canvas without revealing it in the layer
  // tree: that would switch the sidebar away from this list (and take keyboard focus with it).
  if (first) selectNodes([first])
}
