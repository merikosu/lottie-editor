import {
  Ellipsis,
  Eraser,
  ImageDown,
  ImagePlus,
  Plus,
  Search,
  TriangleAlert,
  Type,
  X,
} from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  MenuItem,
  Popover,
  PopoverTrigger,
  Section,
  TextInput,
  Tooltip,
} from '@/components/ui'
import { useT } from '@/i18n'
import { imageFileName } from '@/lottie/assets'
import { toggleSection } from '@/store/prefs'
import { addMissingFonts, chooseImagesToAdd, chooseMissingImages, removeUnused } from './actions'
import { useFontsVersion } from './font-availability'
import { FontEditor } from './FontEditor'
import { useAssetsModel, type AssetsModel } from './model'
import { AssetList } from './AssetRow'
import { compositionMenu, fontMenu, imageMenu } from './menus'
import { CompositionRow, FontRow, ImageRow } from './rows'
import { ThumbnailPreview } from './Thumbnail'
import { editFont, sameKey, selectAsset, setAssetFilter, useAssetsUi } from './store'

/** Above this many rows, off-screen rows skip layout and paint (content-visibility). */
const LAZY_ROWS = 60

function matches(query: string, ...fields: (string | undefined | null)[]): boolean {
  return fields.some((f) => !!f && f.toLowerCase().includes(query))
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <span className="font-normal text-fg-subtle tabular-nums">{count}</span>
    </span>
  )
}

function EmptyHint({
  text,
  action,
  onAction,
}: {
  text: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2 px-2 text-xs text-fg-subtle">
      <span>{text}</span>
      {action && (
        <Button size="xs" variant="ghost" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  )
}

function Toolbar({ model }: { model: AssetsModel }) {
  const t = useT()
  const filter = useAssetsUi((s) => s.filter)
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-2">
      <TextInput
        icon={Search}
        value={filter}
        onChange={(e) => setAssetFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && filter) {
            e.stopPropagation()
            setAssetFilter('')
          }
        }}
        placeholder={t.assets.filter}
        aria-label={t.assets.filter}
        containerClassName="min-w-0 flex-1"
        data-testid="assets-filter"
        suffix={
          filter ? (
            <button
              type="button"
              aria-label={t.common.clear}
              onClick={() => setAssetFilter('')}
              className="flex size-4 items-center justify-center rounded-sm text-fg-subtle hover:text-fg"
            >
              <X size={12} />
            </button>
          ) : null
        }
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton icon={Plus} label={t.assets.add} data-testid="assets-add" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <MenuItem icon={ImagePlus} onSelect={() => void chooseImagesToAdd()}>
            {t.assets.actions.addImage}
          </MenuItem>
          <MenuItem
            icon={Type}
            onSelect={() => {
              toggleSection('assets.fonts', false)
              // Open after the menu has closed so the popover can take focus.
              requestAnimationFrame(() => editFont(''))
            }}
          >
            {t.assets.actions.addFont}
          </MenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton icon={Ellipsis} label={t.assets.more} data-testid="assets-more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <MenuItem
            icon={ImageDown}
            disabled={model.externalCount === 0}
            onSelect={() => void chooseMissingImages()}
          >
            <span className="flex items-center justify-between gap-3">
              {t.assets.actions.embedMissing}
              {model.externalCount > 0 && (
                <span className="tabular-nums opacity-60">{model.externalCount}</span>
              )}
            </span>
          </MenuItem>
          <MenuItem
            icon={Eraser}
            disabled={model.unusedCount === 0}
            onSelect={() => void removeUnused()}
          >
            <span className="flex items-center justify-between gap-3">
              {t.assets.actions.removeUnused}
              {model.unusedCount > 0 && (
                <span className="tabular-nums opacity-60">{model.unusedCount}</span>
              )}
            </span>
          </MenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function AddFontButton() {
  const t = useT()
  const open = useAssetsUi((s) => s.editingFont === '')
  return (
    <Popover open={open} onOpenChange={(o) => editFont(o ? '' : null)}>
      <PopoverTrigger asChild>
        <IconButton icon={Plus} label={t.assets.addFontHint} />
      </PopoverTrigger>
      {open && <FontEditor />}
    </Popover>
  )
}

/** Left sidebar "Assets" tab: images, precompositions and fonts of the document. */
export function AssetsPanel() {
  const t = useT()
  const model = useAssetsModel()
  const filter = useAssetsUi((s) => s.filter.trim().toLowerCase())
  const selected = useAssetsUi((s) => s.selected)
  const fontsVersion = useFontsVersion()

  const images = filter
    ? model.images.filter((i) => matches(filter, i.asset.id, i.asset.nm, imageFileName(i.asset)))
    : model.images
  const precomps = filter
    ? model.precomps.filter((p) => matches(filter, p.asset.id, p.asset.nm))
    : model.precomps
  const fonts = filter
    ? model.fonts.filter((f) => matches(filter, f.fName, f.fFamily, f.fStyle))
    : model.fonts
  const nothing = filter && images.length + precomps.length + fonts.length === 0
  // Each list is one tab stop: its selected row, or its first row while none is selected.
  const imageStop = !images.some((i) => sameKey(selected, { kind: 'image', id: i.asset.id }))
  const compStop = !precomps.some((p) => sameKey(selected, { kind: 'comp', id: p.asset.id }))
  const fontStop = !fonts.some((f) => sameKey(selected, { kind: 'font', id: f.fName }))

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="assets-panel">
      <ThumbnailPreview />
      <Toolbar model={model} />
      {nothing ? (
        <EmptyState icon={Search} title={t.assets.empty.filtered} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {(!filter || images.length > 0) && (
            <Section
              id="assets.images"
              title={<SectionTitle label={t.assets.sections.images} count={model.images.length} />}
              actions={
                <IconButton
                  icon={Plus}
                  label={t.assets.addImageHint}
                  onClick={() => void chooseImagesToAdd()}
                />
              }
              contentClassName="gap-0 px-1 pb-2"
            >
              {images.length ? (
                <AssetList
                  label={t.assets.sections.images}
                  onRowContext={(id) => selectAsset({ kind: 'image', id })}
                  renderMenu={(id, kind) => {
                    const info = images.find((i) => i.asset.id === id)
                    return info
                      ? imageMenu(t, kind, {
                          id,
                          status: info.status,
                          userCount: model.imageUsers.get(id)?.length ?? 0,
                          reachable: model.reachable.has(id),
                        })
                      : null
                  }}
                >
                  {images.map((info, i) => (
                    <ImageRow
                      key={`${info.index}:${info.asset.id}`}
                      asset={info.asset}
                      index={info.index}
                      userCount={model.imageUsers.get(info.asset.id)?.length ?? 0}
                      reachable={model.reachable.has(info.asset.id)}
                      selected={sameKey(selected, { kind: 'image', id: info.asset.id })}
                      tabbable={imageStop && i === 0}
                      lazy={images.length > LAZY_ROWS}
                    />
                  ))}
                </AssetList>
              ) : (
                <EmptyHint
                  text={t.assets.empty.images}
                  action={t.assets.empty.imagesAction}
                  onAction={() => void chooseImagesToAdd()}
                />
              )}
            </Section>
          )}

          {(!filter || precomps.length > 0) && (
            <Section
              id="assets.comps"
              title={
                <SectionTitle
                  label={t.assets.sections.compositions}
                  count={model.precomps.length}
                />
              }
              contentClassName="gap-0 px-1 pb-2"
            >
              {precomps.length ? (
                <AssetList
                  label={t.assets.sections.compositions}
                  onRowContext={(id) => selectAsset({ kind: 'comp', id })}
                  renderMenu={(id, kind) => {
                    const p = precomps.find((c) => c.asset.id === id)
                    return p
                      ? compositionMenu(t, kind, {
                          id,
                          userCount: p.instances.length,
                          reachable: model.reachable.has(id),
                        })
                      : null
                  }}
                >
                  {precomps.map((p, i) => (
                    <CompositionRow
                      key={`${p.index}:${p.asset.id}`}
                      asset={p.asset}
                      w={p.w}
                      h={p.h}
                      layerCount={p.layerCount}
                      userCount={p.instances.length}
                      reachable={model.reachable.has(p.asset.id)}
                      selected={sameKey(selected, { kind: 'comp', id: p.asset.id })}
                      tabbable={compStop && i === 0}
                      lazy={precomps.length > LAZY_ROWS}
                    />
                  ))}
                </AssetList>
              ) : (
                <EmptyHint text={t.assets.empty.compositions} />
              )}
            </Section>
          )}

          {(!filter || fonts.length > 0) && (
            <Section
              id="assets.fonts"
              title={<SectionTitle label={t.assets.sections.fonts} count={model.fonts.length} />}
              actions={<AddFontButton />}
              contentClassName="gap-0 px-1 pb-2"
            >
              {model.undefinedFonts.length > 0 && !filter && (
                <div className="mx-1 mb-1 flex items-start gap-2 rounded-md bg-warning-subtle px-2 py-1.5 text-xs text-fg-muted">
                  <TriangleAlert size={14} className="mt-px shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">
                    {t.assets.font.undefinedFonts(model.undefinedFonts.join(', '))}
                  </span>
                  <Tooltip content={t.assets.history.addFont}>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="-my-0.5 shrink-0"
                      onClick={() => addMissingFonts(model.undefinedFonts)}
                    >
                      {t.common.add}
                    </Button>
                  </Tooltip>
                </div>
              )}
              {fonts.length ? (
                <AssetList
                  label={t.assets.sections.fonts}
                  onRowContext={(id) => selectAsset({ kind: 'font', id })}
                  renderMenu={(id, kind) =>
                    fontMenu(t, kind, {
                      fName: id,
                      userCount: model.fontUsers.get(id)?.length ?? 0,
                    })
                  }
                >
                  {fonts.map((font, i) => (
                    <FontRow
                      key={`${i}:${font.fName}`}
                      font={font}
                      userCount={model.fontUsers.get(font.fName)?.length ?? 0}
                      selected={sameKey(selected, { kind: 'font', id: font.fName })}
                      tabbable={fontStop && i === 0}
                      lazy={fonts.length > LAZY_ROWS}
                      fontsVersion={fontsVersion}
                    />
                  ))}
                </AssetList>
              ) : (
                <EmptyHint
                  text={t.assets.empty.fonts}
                  action={t.assets.empty.fontsAction}
                  onAction={() => editFont('')}
                />
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
