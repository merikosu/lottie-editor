/**
 * Sections specific to a layer type: solid, image, precomp.
 */
import { ImageOff, Layers as LayersIcon, MousePointerClick, PanelLeft } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  ColorField,
  Section,
  TextInput,
  Tooltip,
  type ChangeGesture,
} from '@/components/ui'
import { layout } from '@/app/layout'
import { useDocumentColors } from '@/features/colors'
import { useT } from '@/i18n'
import { hexToRgba, rgbaToHex } from '@/lib/color'
import { formatBytes } from '@/lib/format'
import { roundTo } from '@/lib/math'
import { getAt, pathFromKey, pathKey, type NodePath } from '@/lottie/path'
import { findAsset, findPrecomp } from '@/lottie/traverse'
import type { Animation, ImageAsset, ImageLayer, PrecompLayer, SolidLayer } from '@/lottie/types'
import { isImageAsset, isPrecompLayer } from '@/lottie/types'
import { selectNodes, updateDoc, useDocument } from '@/store/document'
import { setPrefs } from '@/store/prefs'
import { NumberPairRow } from '../components/plain'
import { gestureOptions } from '../edit'
import { InspectorRow, Note } from '../components/Row'

function editLayer<T>(
  label: string,
  path: NodePath,
  fn: (layer: T) => void,
  gesture?: ChangeGesture,
) {
  updateDoc(
    label,
    (draft) => {
      const layer = getAt<T>(draft, path)
      if (layer) fn(layer)
    },
    gestureOptions(gesture),
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Solid                                   */
/* -------------------------------------------------------------------------- */

export function SolidSection({ path, layer }: { path: NodePath; layer: SolidLayer }) {
  const t = useT()
  const swatches = useDocumentColors()
  const color = hexToRgba(layer.sc ?? '#000000')
  return (
    <Section id="inspector.solid" title={t.inspector.sections.solid}>
      <InspectorRow label={t.inspector.solid.color}>
        <ColorField
          className="w-full"
          value={color ? { ...color, a: 1 } : null}
          alpha={false}
          swatches={swatches}
          onChange={(c, g) =>
            editLayer<SolidLayer>(
              t.inspector.history.solid,
              path,
              (l) => void (l.sc = rgbaToHex(c)),
              g,
            )
          }
        />
      </InspectorRow>
      <NumberPairRow
        label={t.inspector.solid.size}
        values={[layer.sw ?? null, layer.sh ?? null]}
        labels={['W', 'H']}
        min={[1, 1]}
        onChange={(i, v, g) =>
          editLayer<SolidLayer>(
            t.inspector.history.solid,
            path,
            (l) => {
              if (i === 0) l.sw = Math.max(1, Math.round(v))
              else l.sh = Math.max(1, Math.round(v))
            },
            g,
          )
        }
      />
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Image                                   */
/* -------------------------------------------------------------------------- */

function imageSource(asset: ImageAsset): string | null {
  const p = asset.p ?? ''
  if (asset.e === 1 || /^(data:|blob:|https?:)/i.test(p)) return p
  const full = `${asset.u ?? ''}${p}`
  return /^https?:/i.test(full) ? full : null
}

function showAssetsPanel() {
  setPrefs({ leftTab: 'assets' })
  const l = layout()
  if (l.isLeftCollapsed()) l.toggleLeft()
}

export function ImageSection({ layer }: { layer: ImageLayer }) {
  const t = useT()
  const ti = t.inspector.image
  // Select the asset object itself: selectors must return stable references.
  const found = useDocument((s) => (s.doc ? (findAsset(s.doc, layer.refId)?.asset ?? null) : null))
  const asset = found && isImageAsset(found) ? found : null
  const [failed, setFailed] = useState<string | null>(null)
  const src = asset ? imageSource(asset) : null
  const embeddedBytes =
    asset && asset.p?.startsWith('data:')
      ? Math.round((asset.p.length - asset.p.indexOf(',') - 1) * 0.75)
      : null

  return (
    <Section id="inspector.image" title={t.inspector.sections.image}>
      {!asset ? (
        <Note tone="warning" icon={<ImageOff size={12} />}>
          {ti.missing}
        </Note>
      ) : (
        <>
          <div className="flex h-32 items-center justify-center overflow-hidden rounded-md checkerboard shadow-[inset_0_0_0_1px_var(--le-line)]">
            {src && failed !== src ? (
              <img
                src={src}
                alt={asset.nm ?? asset.id}
                onError={() => setFailed(src)}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-xs text-fg-subtle">
                <ImageOff size={16} className="text-fg-faint" />
                {ti.noPreview}
              </div>
            )}
          </div>
          <InspectorRow label={ti.asset}>
            <span className="selectable truncate font-mono text-xs text-fg" title={asset.id}>
              {asset.id}
            </span>
          </InspectorRow>
          <InspectorRow label={ti.size}>
            <span className="text-sm text-fg tabular-nums">
              {asset.w ?? '—'} × {asset.h ?? '—'}
            </span>
          </InspectorRow>
          <InspectorRow label={ti.source}>
            <span
              className="min-w-0 truncate text-sm text-fg"
              title={asset.e === 1 ? undefined : `${asset.u ?? ''}${asset.p}`}
            >
              {asset.e === 1 || asset.p?.startsWith('data:')
                ? `${ti.embedded}${embeddedBytes ? ` · ${formatBytes(embeddedBytes)}` : ''}`
                : `${ti.external} · ${asset.p}`}
            </span>
          </InspectorRow>
        </>
      )}
      <Button
        variant="secondary"
        size="sm"
        icon={PanelLeft}
        className="w-full"
        onClick={showAssetsPanel}
      >
        {ti.showInAssets}
      </Button>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Precomp                                  */
/* -------------------------------------------------------------------------- */

function instancePaths(doc: Animation, refId: string): NodePath[] {
  const out: NodePath[] = []
  const visit = (layers: unknown, base: NodePath) => {
    if (!Array.isArray(layers)) return
    layers.forEach((l, i) => {
      if (l && isPrecompLayer(l) && l.refId === refId) out.push([...base, i])
    })
  }
  visit(doc.layers, ['layers'])
  doc.assets?.forEach((a, i) => {
    if ('layers' in a) visit(a.layers, ['assets', i, 'layers'])
  })
  return out
}

export function PrecompSection({ path, layer }: { path: NodePath; layer: PrecompLayer }) {
  const t = useT()
  const tp = t.inspector.precomp
  const asset = useDocument((s) =>
    s.doc ? (findPrecomp(s.doc, layer.refId)?.asset ?? null) : null,
  )
  const index = useDocument((s) => (s.doc ? (findPrecomp(s.doc, layer.refId)?.index ?? -1) : -1))
  const instances = useDocument((s) =>
    s.doc ? instancePaths(s.doc, layer.refId).map(pathKey).join(';') : '',
  )
  const instanceList = instances ? instances.split(';') : []
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  if (!asset) {
    return (
      <Section id="inspector.precomp" title={t.inspector.sections.composition}>
        <Note tone="warning">{tp.missing}</Note>
      </Section>
    )
  }
  const assetName = asset.nm ?? ''

  const commitName = () => {
    if (nameDraft === null) return
    const next = nameDraft.trim()
    setNameDraft(null)
    if (next === assetName) return
    updateDoc(t.inspector.history.composition, (draft) => {
      const a = draft.assets?.[index]
      if (!a) return
      if (next) a.nm = next
      else delete a.nm
    })
  }

  return (
    <Section id="inspector.precomp" title={t.inspector.sections.composition}>
      <InspectorRow label={tp.name}>
        <TextInput
          value={nameDraft ?? assetName}
          placeholder={asset.id}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setNameDraft(null)
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
            }
          }}
          containerClassName="w-full"
          aria-label={tp.name}
        />
      </InspectorRow>
      <NumberPairRow
        label={tp.size}
        values={[layer.w ?? null, layer.h ?? null]}
        labels={['W', 'H']}
        min={[1, 1]}
        onChange={(i, v, g) =>
          editLayer<PrecompLayer>(
            t.inspector.history.composition,
            path,
            (l) => {
              if (i === 0) l.w = Math.max(1, roundTo(v, 0))
              else l.h = Math.max(1, roundTo(v, 0))
            },
            g,
          )
        }
      />
      <InspectorRow label={tp.contents}>
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
          <LayersIcon size={12} className="shrink-0 text-fg-subtle" />
          <span className="truncate tabular-nums">{tp.layers(asset.layers.length)}</span>
        </span>
      </InspectorRow>
      {instanceList.length > 1 && (
        <>
          <InspectorRow label={tp.usedBy}>
            <span className="min-w-0 flex-1 truncate text-sm text-fg-muted tabular-nums">
              {tp.instances(instanceList.length)}
            </span>
            <Tooltip content={tp.selectInstancesHint} side="left">
              <Button
                variant="ghost"
                size="sm"
                icon={MousePointerClick}
                className="-mr-1 text-fg-muted"
                onClick={() => selectNodes(instanceList.map(pathFromKey))}
              >
                {tp.selectInstances}
              </Button>
            </Tooltip>
          </InspectorRow>
          <Note className="pl-5">{tp.sharedNote}</Note>
        </>
      )}
    </Section>
  )
}
