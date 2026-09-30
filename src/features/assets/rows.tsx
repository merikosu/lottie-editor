import { memo } from 'react'
import { LayerKindIcon } from '@/components/lottie/icons'
import { Badge, Popover, PopoverAnchor, Tooltip } from '@/components/ui'
import { nameText } from '@/features/inspector/model/names'
import { useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { describeImage, fontOrigin, fontWeightFor, validateAssetId } from '@/lottie/assets'
import { cssFontFamily, fontStack } from '@/lottie/text'
import type { Font, ImageAsset, PrecompAsset } from '@/lottie/types'
import { getDoc } from '@/store/document'
import {
  chooseReplacement,
  deleteAsset,
  embedFile,
  removeFontEntry,
  renameAssetId,
  renameAssetName,
  replaceImageWithFile,
  selectLayers,
} from './actions'
import { AssetRow, RenameField } from './AssetRow'
import { isFontStackAvailable } from './font-availability'
import { FontEditor } from './FontEditor'
import { isImageFile } from './image-file'
import { compositionMenu, fontMenu, imageMenu, selectComposition, usersOf } from './menus'
import { editFont, selectAsset, setDragOver, startRename, stopRename, useAssetsUi } from './store'
import { ImageThumb } from './Thumbnail'

function validateId(t: Dict, id: string) {
  return (value: string) => {
    const problem = validateAssetId(getDoc() ?? {}, value, id)
    return problem === 'empty'
      ? t.assets.idEmpty
      : problem === 'duplicate'
        ? t.assets.idTaken
        : null
  }
}

/** Inline editor for an asset's display name or id (null when not renaming). */
function renameEditor(t: Dict, id: string, nm: string | undefined, field: 'id' | 'name' | null) {
  if (field === 'name') {
    return (
      <RenameField
        initial={nameText(nm) || id}
        label={t.assets.actions.rename}
        onCommit={(v) => {
          renameAssetName(id, v)
          stopRename()
        }}
        onCancel={stopRename}
      />
    )
  }
  if (field === 'id') {
    return (
      <RenameField
        initial={id}
        label={t.assets.actions.renameId}
        validate={validateId(t, id)}
        onCommit={(v) => {
          renameAssetId(id, v)
          stopRename()
        }}
        onCancel={stopRename}
      />
    )
  }
  return undefined
}

function Usage({ count, reachable }: { count: number; reachable: boolean }) {
  const t = useT()
  return (
    <span className={cn(count === 0 || !reachable ? 'text-fg-faint' : 'text-fg-muted')}>
      {t.assets.usage(count)}
    </span>
  )
}

function usageHint(t: Dict, count: number, reachable: boolean): string {
  return count > 0 && !reachable ? t.assets.unreachable : t.assets.usedBy(count)
}

/* --------------------------------- Images --------------------------------- */

interface ImageRowProps {
  asset: ImageAsset
  index: number
  userCount: number
  reachable: boolean
  selected: boolean
  /** Tab stop of the list while none of its rows is selected. */
  tabbable?: boolean
  lazy: boolean
}

export const ImageRow = memo(function ImageRow({
  asset,
  index,
  userCount,
  reachable,
  selected,
  tabbable,
  lazy,
}: ImageRowProps) {
  const t = useT()
  const info = describeImage(asset, index)
  const renaming = useAssetsUi((s) =>
    s.renaming?.kind === 'image' && s.renaming.id === asset.id ? s.renaming.field : null,
  )
  const dragOver = useAssetsUi((s) => s.dragOver === asset.id)
  const key = { kind: 'image' as const, id: asset.id }
  const used = userCount > 0

  const format = info.mime?.split('/')[1]?.replace('svg+xml', 'svg').toUpperCase()
  const details =
    info.status === 'embedded'
      ? [format, info.bytes !== null ? formatBytes(info.bytes) : null].filter(Boolean).join(' · ')
      : info.fileName
  const name = nameText(asset.nm) || asset.id
  const meta = [
    name !== asset.id ? asset.id : null,
    asset.w && asset.h ? `${asset.w} × ${asset.h}` : t.assets.sizeUnknown,
    details,
  ]
    .filter(Boolean)
    .join(' · ')

  const badge =
    info.status === 'missing' ? (
      <Tooltip content={t.assets.statusHint.missing} side="top">
        <span className="inline-flex">
          <Badge tone="warning">{t.assets.status.missing}</Badge>
        </span>
      </Tooltip>
    ) : info.status === 'linked' ? (
      <Tooltip content={t.assets.statusHint.linked} side="top">
        <span className="inline-flex">
          <Badge>{t.assets.status.linked}</Badge>
        </span>
      </Tooltip>
    ) : null

  return (
    <AssetRow
      id={asset.id}
      testId="asset-image"
      lazy={lazy}
      selected={selected}
      tabbable={tabbable}
      thumb={<ImageThumb src={info.src} w={asset.w} h={asset.h} bytes={info.bytes} />}
      title={name}
      titleText={name !== asset.id ? `${name} (${asset.id})` : name}
      badge={badge}
      meta={meta}
      trailing={<Usage count={userCount} reachable={reachable} />}
      trailingHint={usageHint(t, userCount, reachable)}
      menu={(kind) =>
        imageMenu(t, kind, { id: asset.id, status: info.status, userCount, reachable })
      }
      onSelect={() => selectAsset(key)}
      onOpen={() =>
        used ? selectLayers(usersOf('image', asset.id)) : void chooseReplacement(asset.id)
      }
      onRename={() => startRename(key, 'name')}
      onDelete={used && reachable ? undefined : () => deleteAsset(asset.id)}
      renaming={renameEditor(t, asset.id, asset.nm, renaming)}
      onDropFiles={(files) => {
        const file = files.find(isImageFile)
        if (!file) return
        selectAsset(key)
        void (info.status === 'embedded'
          ? replaceImageWithFile(asset.id, file)
          : embedFile(asset.id, file))
      }}
      dropLabel={t.assets.dropToReplace}
      dragOver={dragOver}
      onDragOverChange={(over) => setDragOver(over ? asset.id : null)}
    />
  )
})

/* ------------------------------ Compositions ------------------------------ */

interface CompositionRowProps {
  asset: PrecompAsset
  w: number | null
  h: number | null
  layerCount: number
  userCount: number
  reachable: boolean
  selected: boolean
  /** Tab stop of the list while none of its rows is selected. */
  tabbable?: boolean
  lazy: boolean
}

export const CompositionRow = memo(function CompositionRow(props: CompositionRowProps) {
  const { asset, w, h, layerCount, userCount, reachable, selected, tabbable, lazy } = props
  const t = useT()
  const renaming = useAssetsUi((s) =>
    s.renaming?.kind === 'comp' && s.renaming.id === asset.id ? s.renaming.field : null,
  )
  const key = { kind: 'comp' as const, id: asset.id }
  const used = userCount > 0
  const name = nameText(asset.nm) || asset.id
  const meta = [
    nameText(asset.nm) && asset.nm !== asset.id ? asset.id : null,
    w && h ? `${w} × ${h}` : null,
    t.assets.layerCount(layerCount),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <AssetRow
      id={asset.id}
      testId="asset-comp"
      lazy={lazy}
      selected={selected}
      tabbable={tabbable}
      thumb={
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--le-line)]">
          <LayerKindIcon kind="precomp" size={16} />
        </div>
      }
      title={name}
      titleText={name}
      meta={meta}
      trailing={<Usage count={userCount} reachable={reachable} />}
      trailingHint={usageHint(t, userCount, reachable)}
      menu={(kind) => compositionMenu(t, kind, { id: asset.id, userCount, reachable })}
      onSelect={() => selectComposition(asset.id)}
      onOpen={() => selectLayers(usersOf('comp', asset.id))}
      onRename={() => startRename(key, 'name')}
      onDelete={used && reachable ? undefined : () => deleteAsset(asset.id)}
      renaming={renameEditor(t, asset.id, asset.nm, renaming)}
    />
  )
})

/* ---------------------------------- Fonts --------------------------------- */

interface FontRowProps {
  font: Font
  userCount: number
  selected: boolean
  /** Tab stop of the list while none of its rows is selected. */
  tabbable?: boolean
  lazy: boolean
  /** Changes when web fonts finish loading (re-checks availability). */
  fontsVersion: number
}

export const FontRow = memo(function FontRow({
  font,
  userCount,
  selected,
  tabbable,
  lazy,
}: FontRowProps) {
  const t = useT()
  const editing = useAssetsUi((s) => s.editingFont === font.fName)
  const key = { kind: 'font' as const, id: font.fName }
  const available = isFontStackAvailable(font.fFamily)
  // A CSS stack ("Inter Variable, Inter, sans-serif") is named by its first family.
  const family = fontStack(font.fFamily)[0] ?? font.fFamily
  const used = userCount > 0
  const meta = `${font.fName} · ${t.assets.font.origins[fontOrigin(font)]}`
  const availability = available ? t.assets.font.available : t.assets.font.unavailable

  return (
    <Popover open={editing} onOpenChange={(open) => editFont(open ? font.fName : null)}>
      <AssetRow
        id={font.fName}
        testId="asset-font"
        lazy={lazy}
        selected={selected}
        tabbable={tabbable}
        thumb={
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-base text-fg shadow-[inset_0_0_0_1px_var(--le-line)]"
            style={{
              fontFamily: cssFontFamily(font.fFamily, 'var(--font-sans)'),
              fontWeight: fontWeightFor(font.fStyle ?? ''),
            }}
            aria-hidden
          >
            Aa
          </div>
        }
        title={
          <>
            {family}
            {font.fStyle && <span className="text-fg-muted"> {font.fStyle}</span>}
          </>
        }
        titleText={`${font.fFamily} ${font.fStyle ?? ''}`.trim()}
        badge={
          <Tooltip content={availability} side="top">
            <span className="flex shrink-0 items-center">
              <span
                className={cn('size-1.5 rounded-full', available ? 'bg-success' : 'bg-warning')}
                aria-hidden
              />
              <span className="sr-only">{availability}</span>
            </span>
          </Tooltip>
        }
        meta={meta}
        trailing={<Usage count={userCount} reachable />}
        trailingHint={userCount ? t.assets.textLayerCount(userCount) : t.assets.usedBy(0)}
        menu={(kind) => fontMenu(t, kind, { fName: font.fName, userCount })}
        onSelect={() => selectAsset(key)}
        onOpen={() => editFont(font.fName)}
        onRename={() => editFont(font.fName)}
        onDelete={used ? undefined : () => removeFontEntry(font.fName)}
      >
        <PopoverAnchor asChild>
          <span className="pointer-events-none absolute inset-x-2 bottom-0 h-0" aria-hidden />
        </PopoverAnchor>
      </AssetRow>
      {editing && <FontEditor font={font} />}
    </Popover>
  )
})
