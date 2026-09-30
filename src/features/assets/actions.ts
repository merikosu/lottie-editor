/**
 * Asset operations used by the panel, its menus, commands and the image file handler.
 * Every document change is one undoable step with a translated label.
 */
import { toast } from '@/components/ui'
import { getT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { downloadBlob } from '@/lib/download'
import { emit } from '@/lib/events'
import {
  addFont,
  addImageAsset,
  addImageLayer,
  dataUriToBytes,
  imageFileName,
  imageMime,
  imageSrc,
  imageStatus,
  matchFilesToImages,
  removeAssets,
  removeFont,
  removeUnusedAssets,
  renameAsset,
  replaceImageAsset,
  unusedAssets,
  updateFont,
  type FontPatch,
  type NewFont,
} from '@/lottie/assets'
import { getAt, isLayerPath, layerPathOf, type NodePath } from '@/lottie/path'
import type { Animation, ImageAsset, Layer } from '@/lottie/types'
import { isImageAsset, isPrecompAsset } from '@/lottie/types'
import { getDoc, primaryNode, selectNodes, updateDoc, useDocument } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { openDialog } from '@/store/ui'
import { IMAGE_ACCEPT, isImageFile, pickFiles, readImageFile, type LoadedImage } from './image-file'
import { selectAsset, useAssetsUi } from './store'

export const REPLACE_DIALOG = 'assets.replace-image'

export interface ReplaceDialogProps {
  assetId: string
  image: LoadedImage
}

function findImage(doc: Animation | null, id: string): ImageAsset | null {
  const asset = doc?.assets?.find((a) => a.id === id)
  return asset && isImageAsset(asset) ? asset : null
}

/** Reads files, reporting the ones that are not decodable images. */
async function readImages(files: File[]): Promise<{ file: File; image: LoadedImage }[]> {
  const t = getT()
  const out: { file: File; image: LoadedImage }[] = []
  for (const file of files) {
    try {
      out.push({ file, image: await readImageFile(file) })
    } catch (err) {
      console.warn('Assets: could not read image', file.name, err)
      toast.error(t.assets.errors.read(file.name), { description: t.assets.errors.readHint })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                   Replace                                  */
/* -------------------------------------------------------------------------- */

const sameAspect = (w1: number, h1: number, w2: number, h2: number) =>
  Math.abs(w1 / h1 - w2 / h2) <= (w1 / h1) * 0.01

/**
 * Writes new pixels into an image asset with the given display size. A new size keeps the
 * picture centered where it was (the layers' anchors follow).
 */
export function commitReplace(assetId: string, image: LoadedImage, w: number, h: number): void {
  updateDoc(getT().assets.history.replaceImage, (d) => {
    replaceImageAsset(d, assetId, image.dataUri, w, h, { keepCenter: true })
  })
}

/**
 * Replaces an image asset's pixels, keeping its id so every layer using it updates.
 * Same proportions keep the displayed size (a sharper version stays in place); different
 * proportions ask how the new image should fit.
 */
export async function replaceImageWithFile(assetId: string, file: File): Promise<void> {
  const [loaded] = await readImages([file])
  const asset = findImage(getDoc(), assetId)
  if (!loaded || !asset) return
  const { image } = loaded
  const w = asset.w ?? 0
  const h = asset.h ?? 0
  if (!(w > 0 && h > 0)) {
    commitReplace(assetId, image, image.w, image.h)
  } else if (sameAspect(w, h, image.w, image.h)) {
    commitReplace(assetId, image, w, h)
  } else {
    openDialog(REPLACE_DIALOG, { assetId, image } satisfies ReplaceDialogProps)
  }
}

export async function chooseReplacement(assetId: string): Promise<void> {
  const [file] = await pickFiles(IMAGE_ACCEPT)
  if (file) await replaceImageWithFile(assetId, file)
}

/* -------------------------------------------------------------------------- */
/*                                  Add images                                */
/* -------------------------------------------------------------------------- */

/** Where new layers go: above the selected layer (in its composition), else on top of the root. */
function insertionPoint(doc: Animation): { layersPath: NodePath; index: number } {
  const primary = primaryNode(useDocument.getState().selection)
  const layerPath = primary ? layerPathOf(primary) : null
  if (layerPath && isLayerPath(layerPath) && getAt(doc, layerPath)) {
    return { layersPath: layerPath.slice(0, -1), index: layerPath[layerPath.length - 1] as number }
  }
  return { layersPath: ['layers'], index: 0 }
}

/** Embeds images and adds a centered image layer for each (first file ends up on top). */
export async function addImages(files: File[]): Promise<void> {
  const loaded = await readImages(files)
  const doc = getDoc()
  if (!loaded.length || !doc) return
  const t = getT()
  const { layersPath, index } = insertionPoint(doc)
  const paths: NodePath[] = loaded.map((_, i) => [...layersPath, index + i])
  updateDoc(
    loaded.length === 1 ? t.assets.history.addImage : t.assets.history.addImages(loaded.length),
    (d) => {
      for (const { image } of [...loaded].reverse()) {
        const assetId = addImageAsset(d, image.dataUri, image.w, image.h, image.name)
        addImageLayer(d, { assetId, w: image.w, h: image.h, name: image.name, layersPath, index })
      }
    },
    { selection: { nodes: paths, keyframes: [], property: null } },
  )
}

export async function chooseImagesToAdd(): Promise<void> {
  const files = await pickFiles(IMAGE_ACCEPT, true)
  if (files.length) await addImages(files)
}

/* -------------------------------------------------------------------------- */
/*                                    Embed                                   */
/* -------------------------------------------------------------------------- */

/** Embeds files into the given image assets, keeping each asset's display size. */
async function embedInto(pairs: { assetId: string; file: File }[]): Promise<number> {
  const loaded = await readImages(pairs.map((p) => p.file))
  if (!loaded.length) return 0
  const byFile = new Map(loaded.map((l) => [l.file, l.image]))
  const t = getT()
  let count = 0
  updateDoc(t.assets.history.embedImages(loaded.length), (d) => {
    for (const { assetId, file } of pairs) {
      const image = byFile.get(file)
      const asset = d.assets?.find((a) => a.id === assetId)
      if (!image || !asset || !isImageAsset(asset)) continue
      const w = asset.w && asset.w > 0 ? asset.w : image.w
      const h = asset.h && asset.h > 0 ? asset.h : image.h
      if (replaceImageAsset(d, assetId, image.dataUri, w, h)) count++
    }
  })
  return count
}

/**
 * Embeds external (missing or linked) images from files matched by name. Returns the files
 * that matched nothing.
 */
export async function embedMatchingFiles(files: File[]): Promise<File[]> {
  const doc = getDoc()
  if (!doc) return files
  const matches = matchFilesToImages(
    doc,
    files.map((f) => f.name),
  )
  const byName = new Map(files.map((f) => [f.name, f]))
  const pairs = [...matches].map(([assetId, name]) => ({ assetId, file: byName.get(name)! }))
  if (pairs.length) await embedInto(pairs)
  const used = new Set(pairs.map((p) => p.file))
  return files.filter((f) => !used.has(f))
}

function reportUnmatched(unmatched: File[], total: number): void {
  const t = getT()
  if (!unmatched.length) return
  if (unmatched.length === total)
    toast.warning(t.assets.noMatches, { description: t.assets.unmatchedHint })
  else
    toast.warning(t.assets.unmatched(unmatched.length), {
      description: unmatched.map((f) => f.name).join(', '),
    })
}

/** File picker for all missing images at once (matched by file name). */
export async function chooseMissingImages(): Promise<void> {
  const files = (await pickFiles(IMAGE_ACCEPT, true)).filter(isImageFile)
  if (!files.length) return
  reportUnmatched(await embedMatchingFiles(files), files.length)
}

/** Embeds a file into an external (missing or linked) image, keeping its display size. */
export async function embedFile(assetId: string, file: File): Promise<void> {
  await embedInto([{ assetId, file }])
}

/** File picker for one image: embeds the chosen file into that asset, whatever its name. */
export async function locateImage(assetId: string): Promise<void> {
  const [file] = await pickFiles(IMAGE_ACCEPT)
  if (file) await embedFile(assetId, file)
}

/** Downloads a linked image and embeds it. */
export async function embedLinkedImage(assetId: string): Promise<void> {
  const t = getT()
  const asset = findImage(getDoc(), assetId)
  const src = asset && imageSrc(asset)
  if (!asset || !src || imageStatus(asset) !== 'linked') return
  const name = imageFileName(asset)
  try {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    await embedInto([
      { assetId, file: new File([blob], name, { type: blob.type || imageMime(asset) || '' }) },
    ])
  } catch (err) {
    console.warn('Assets: could not download', src, err)
    toast.error(t.assets.errors.fetch(name), { description: t.assets.errors.fetchHint })
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Download                                  */
/* -------------------------------------------------------------------------- */

export async function downloadImage(assetId: string): Promise<void> {
  const t = getT()
  const asset = findImage(getDoc(), assetId)
  if (!asset) return
  const name = imageFileName(asset)
  try {
    const status = imageStatus(asset)
    if (status === 'embedded') {
      const bytes = dataUriToBytes(asset.p)
      downloadBlob(
        new Blob([bytes as BlobPart], { type: imageMime(asset) ?? 'application/octet-stream' }),
        name,
      )
    } else if (status === 'linked') {
      const res = await fetch(imageSrc(asset)!)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      downloadBlob(await res.blob(), name)
    }
  } catch (err) {
    console.warn('Assets: download failed', err)
    toast.error(t.assets.errors.download, { description: t.assets.errors.fetchHint })
  }
}

/* -------------------------------------------------------------------------- */
/*                          Delete, rename, select                            */
/* -------------------------------------------------------------------------- */

export function deleteAsset(id: string): void {
  updateDoc(getT().assets.history.deleteAsset, (d) => {
    removeAssets(d, [id])
  })
  if (useAssetsUi.getState().selected?.id === id) selectAsset(null)
}

/** Removes images and precomps not reachable from the root composition. */
export function removeUnused(): number {
  const doc = getDoc()
  if (!doc || unusedAssets(doc).length === 0) return 0
  let removed: string[] = []
  updateDoc(getT().assets.history.removeUnused, (d) => {
    removed = removeUnusedAssets(d)
  })
  const selected = useAssetsUi.getState().selected
  if (selected && selected.kind !== 'font' && removed.includes(selected.id)) selectAsset(null)
  return removed.length
}

export function renameAssetId(oldId: string, newId: string): boolean {
  const next = newId.trim()
  if (next === oldId) return true
  const ok = updateDoc(getT().assets.history.renameAsset, (d) => {
    renameAsset(d, oldId, next)
  })
  if (ok) {
    const selected = useAssetsUi.getState().selected
    if (selected && selected.id === oldId && selected.kind !== 'font')
      selectAsset({ ...selected, id: next })
  }
  return ok
}

/** Sets an asset's display name (`nm`); an empty name removes it. References are untouched. */
export function renameAssetName(id: string, name: string): void {
  const doc = getDoc()
  const target = doc?.assets?.find((a) => a.id === id)
  if (!target) return
  const t = getT()
  updateDoc(
    isPrecompAsset(target) ? t.assets.history.renameComposition : t.assets.history.renameImage,
    (d) => {
      const asset = d.assets?.find((a) => a.id === id)
      if (!asset) return
      const nm = name.trim()
      if (nm && nm !== asset.id) asset.nm = nm
      else delete asset.nm
    },
  )
}

/** Selects layers in the document (and scrolls the layer tree / timeline to the first). */
export function selectLayers(paths: NodePath[]): void {
  if (!paths.length) return
  selectNodes(paths)
  emit('reveal-node', { path: paths[0] })
}

export function showInJson(path: NodePath): void {
  emit('reveal-code', { path })
}

export function copyToClipboard(text: string): void {
  void copyText(text)
}

/* -------------------------------------------------------------------------- */
/*                                    Fonts                                   */
/* -------------------------------------------------------------------------- */

export function addFontEntry(font: NewFont): string | null {
  let fName: string | null = null
  updateDoc(getT().assets.history.addFont, (d) => {
    fName = addFont(d, font)
  })
  if (fName) selectAsset({ kind: 'font', id: fName })
  return fName
}

const splitWords = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').trim()

/**
 * Adds entries for fonts that text layers reference but `fonts.list` lacks, guessing family
 * and style from the PostScript-like name ("OpenSans-BoldItalic" → Open Sans, Bold Italic).
 */
export function addMissingFonts(names: string[]): void {
  if (!names.length) return
  updateDoc(getT().assets.history.addFont, (d) => {
    for (const name of names) {
      const [family, ...style] = name.split('-')
      addFont(d, {
        family: splitWords(family) || name,
        style: splitWords(style.join(' ')) || 'Regular',
        name,
      })
    }
  })
}

export function updateFontEntry(fName: string, patch: FontPatch): void {
  updateDoc(getT().assets.history.editFont, (d) => {
    updateFont(d, fName, patch)
  })
}

export function removeFontEntry(fName: string): void {
  updateDoc(getT().assets.history.removeFont, (d) => {
    removeFont(d, fName)
  })
}

/* -------------------------------------------------------------------------- */
/*                                File handler                                */
/* -------------------------------------------------------------------------- */

/** Image asset targeted by a drop: the one selected in the visible Assets panel, or the selected image layer's. */
export function targetImageAssetId(): string | null {
  const doc = getDoc()
  if (!doc) return null
  const selected = useAssetsUi.getState().selected
  if (
    usePrefs.getState().leftTab === 'assets' &&
    selected?.kind === 'image' &&
    findImage(doc, selected.id)
  )
    return selected.id
  const primary = primaryNode(useDocument.getState().selection)
  if (primary && isLayerPath(primary)) {
    const layer = getAt<Layer & { refId?: string }>(doc, primary)
    if (layer && layer.ty === 2 && layer.refId && findImage(doc, layer.refId)) return layer.refId
  }
  return null
}

/**
 * Handles image files dropped, pasted or opened while a document is open:
 *  1. files named like missing/linked images are embedded into them;
 *  2. otherwise a single image replaces the targeted image asset;
 *  3. otherwise every image becomes a new image layer.
 * Returns false (not handled) for anything that is not only images, or with no document.
 */
export async function handleImageFiles(files: File[]): Promise<boolean> {
  if (!files.length || !getDoc() || !files.every(isImageFile)) return false
  const doc = getDoc()!
  if (
    matchFilesToImages(
      doc,
      files.map((f) => f.name),
    ).size > 0
  ) {
    reportUnmatched(await embedMatchingFiles(files), files.length)
    return true
  }
  const target = targetImageAssetId()
  if (target && files.length === 1) {
    await replaceImageWithFile(target, files[0])
    return true
  }
  await addImages(files)
  return true
}
