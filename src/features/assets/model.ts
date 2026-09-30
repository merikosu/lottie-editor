/**
 * Everything the Assets panel shows, derived from the document. Recomputed only when the
 * parts it depends on change identity (assets, layers of any composition, fonts).
 */
import { useMemo } from 'react'
import {
  fontUsage,
  imageUsage,
  listImageAssets,
  listPrecomps,
  reachableAssetIds,
  undefinedFonts,
  type ImageAssetInfo,
  type PrecompInfo,
} from '@/lottie/assets'
import type { NodePath } from '@/lottie/path'
import type { Animation, Font } from '@/lottie/types'
import { useDocument } from '@/store/document'

export interface AssetsModel {
  images: ImageAssetInfo[]
  imageUsers: Map<string, NodePath[]>
  precomps: PrecompInfo[]
  fonts: Font[]
  fontUsers: Map<string, NodePath[]>
  /** Asset ids reachable from the root composition. */
  reachable: Set<string>
  undefinedFonts: string[]
  unusedCount: number
  externalCount: number
}

const EMPTY: AssetsModel = {
  images: [],
  imageUsers: new Map(),
  precomps: [],
  fonts: [],
  fontUsers: new Map(),
  reachable: new Set(),
  undefinedFonts: [],
  unusedCount: 0,
  externalCount: 0,
}

function computeModel(doc: Animation): AssetsModel {
  const images = listImageAssets(doc)
  const precomps = listPrecomps(doc)
  const reachable = reachableAssetIds(doc)
  const fonts = doc.fonts?.list ?? []
  const ids = [...images.map((i) => i.asset.id), ...precomps.map((p) => p.asset.id)]
  return {
    images,
    imageUsers: imageUsage(doc),
    precomps,
    fonts,
    fontUsers: fontUsage(doc),
    reachable,
    undefinedFonts: undefinedFonts(doc),
    unusedCount: ids.filter((id) => !reachable.has(id)).length,
    externalCount: images.filter((i) => i.status !== 'embedded').length,
  }
}

/** Memoized model of the open document's assets. */
export function useAssetsModel(): AssetsModel {
  const hasDoc = useDocument((s) => s.doc !== null)
  const assets = useDocument((s) => s.doc?.assets)
  const layers = useDocument((s) => s.doc?.layers)
  const fonts = useDocument((s) => s.doc?.fonts)
  // Only these subtrees matter: edits elsewhere (timing, markers…) don't recompute. Precomp
  // content edits do (they change `assets`), which is fine: the work is linear in layers.
  return useMemo(
    () => (hasDoc ? computeModel({ assets, layers: layers ?? [], fonts } as Animation) : EMPTY),
    [hasDoc, assets, layers, fonts],
  )
}
