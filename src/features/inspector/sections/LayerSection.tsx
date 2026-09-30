/**
 * Layer basics: parent, blend mode, track matte, timing (in/out, start, stretch, time
 * remap), auto-orient and visibility. Supports several layers at once.
 */
import { ArrowUpRight, Box } from 'lucide-react'
import { memo, useMemo } from 'react'
import { Badge, Section, Tooltip, type ChangeGesture, type SelectOption } from '@/components/ui'
import { layerDisplayName } from '@/components/lottie/labels'
import { useT } from '@/i18n'
import { layerKind } from '@/lottie/layers'
import { compPathOf, getAt, type NodePath } from '@/lottie/path'
import { isAnimated } from '@/lottie/property'
import type { Animation, Layer, PrecompLayer } from '@/lottie/types'
import { isPrecompLayer, isSplitPosition } from '@/lottie/types'
import { formatDecimal } from '@/lib/format'
import { roundTo } from '@/lib/math'
import { getDoc, selectNodes, updateDoc, useDocument } from '@/store/document'
import { usePlayback } from '@/store/playback'
import { ScalarProperty } from '../components/fields'
import { KIND_OPTION_ICONS } from '../components/kind-icons'
import { NumberPairRow, NumberRow, SelectRow, SwitchRow } from '../components/plain'
import { gestureOptions } from '../edit'
import { InspectorRow, Note } from '../components/Row'
import { useNodesAt } from '../hooks'
import {
  canSetTrackMatte,
  disableTimeRemap,
  enableTimeRemap,
  matteSourceIndex,
  matteTargets,
  moveLayerInTime,
  parentCandidates,
  setLayerStretch,
  setTrackMatte,
  type MatteMode,
} from '../model/layer-edit'
import { setParentKeepingPlace } from '../model/parenting'
import { compTimeFor, type CompTime } from '../model/time'
import { commonNumber, commonValue } from '../model/values'
import { propTargets } from './common'

interface LayerSectionProps {
  /** Stable array of layer paths (the section is memoized and reads the layers itself). */
  paths: NodePath[]
  times: CompTime[]
}

/** Runs `fn` on every selected layer inside one undo step. */
function editLayers(
  label: string,
  paths: NodePath[],
  fn: (layer: Layer, layers: Layer[], index: number) => void,
  gesture?: ChangeGesture,
) {
  updateDoc(
    label,
    (draft) => {
      for (const path of paths) {
        const layers = getAt<Layer[]>(draft, compPathOf(path))
        const index = path[path.length - 1] as number
        const layer = layers?.[index]
        if (layers && layer) fn(layer, layers, index)
      }
    },
    gestureOptions(gesture),
  )
}

export const LayerSection = memo(function LayerSection({ paths, times }: LayerSectionProps) {
  const t = useT()
  const stored = useNodesAt<Layer>(paths)
  const layers = stored.filter((l): l is Layer => !!l)
  const fps = useFps()
  const tl = t.inspector.layer
  const history = t.inspector.history
  const single = paths.length === 1
  const compKeys = new Set(paths.map((p) => compPathOf(p).join('/')))
  const sameComp = compKeys.size === 1
  const [compLayers] = useNodesAt<Layer[]>(sameComp ? [compPathOf(paths[0])] : [])
  const index = paths[0][paths[0].length - 1] as number
  const allPrecomp = layers.every(isPrecompLayer)
  // A selected layer was just removed; the selection is pruned on the next update.
  if (layers.length === 0 || layers.length !== paths.length) return null

  /* ----------------------------- Blend mode ------------------------------ */
  const blend = commonValue(layers.map((l) => l.bm ?? 0))
  const blendOptions: SelectOption<string>[] = tl.blendModes.map((label, i) => ({
    value: String(i),
    label,
  }))
  if (blend !== null && blend > 15)
    blendOptions.push({ value: String(blend), label: tl.unsupportedBlend(blend), disabled: true })

  /* ----------------------------- Track matte ----------------------------- */
  const matte = commonValue(layers.map((l) => l.tt ?? 0))
  let matteRows = null
  if (single && compLayers) {
    const canMatte = canSetTrackMatte(compLayers, index)
    const source = matteSourceIndex(compLayers, index)
    const targets = matteTargets(compLayers, index)
    const prefix = compPathOf(paths[0])
    matteRows = (
      <>
        <SelectRow
          label={tl.trackMatte}
          hint={canMatte ? undefined : tl.matteNeedsLayer}
          value={String(matte ?? 0)}
          disabled={!canMatte}
          options={tl.matteModes.map((label, i) => ({ value: String(i), label }))}
          onChange={(v) =>
            editLayers(history.trackMatte, paths, (_l, all, i) =>
              setTrackMatte(all, i, Number(v) as MatteMode),
            )
          }
        />
        {source >= 0 && (
          <LinkRow
            label={tl.matteSource}
            items={[
              {
                path: [...prefix, source],
                name: layerDisplayName(compLayers[source], source, t),
                layer: compLayers[source],
              },
            ]}
          />
        )}
        {targets.length > 0 && (
          <LinkRow
            label={tl.matteFor}
            items={targets.map((i) => ({
              path: [...prefix, i],
              name: layerDisplayName(compLayers[i], i, t),
              layer: compLayers[i],
            }))}
          />
        )}
      </>
    )
  }

  /* -------------------------------- Timing -------------------------------- */
  const ip = commonNumber(layers.map((l) => l.ip))
  const op = commonNumber(layers.map((l) => l.op))
  const st = commonNumber(layers.map((l) => l.st ?? 0))
  const stretchValues = layers.map((l) => (l.sr && l.sr > 0 ? l.sr : 1))
  const stretch = commonNumber(stretchValues)
  const ignoredStretch = !allPrecomp && stretchValues.some((v) => Math.abs(v - 1) > 1e-6)

  const precomps = layers.filter(isPrecompLayer)
  const remap = commonValue(precomps.map((l) => !!l.tm))

  return (
    <Section
      id="inspector.layer"
      title={t.inspector.sections.layer}
      actions={
        layers.some((l) => l.ddd === 1) ? (
          <Tooltip content={tl.threeDHint}>
            <span className="inline-flex">
              <Badge>{tl.threeD}</Badge>
            </span>
          </Tooltip>
        ) : undefined
      }
    >
      {single && <ParentRow path={paths[0]} />}
      <SelectRow
        label={tl.blendMode}
        value={blend === null ? null : String(blend)}
        options={blendOptions}
        onChange={(v) =>
          editLayers(history.blendMode, paths, (l) => {
            // Keep files minimal: "normal" stays absent when it was absent.
            if (Number(v) === 0 && l.bm === undefined) return
            l.bm = Number(v)
          })
        }
      />
      {matteRows}
      <NumberPairRow
        label={tl.time}
        values={[ip, op]}
        labels={[tl.inShort, tl.outShort]}
        labelHints={[tl.inPoint, tl.outPoint]}
        unit={t.common.framesShort}
        precision={2}
        onChange={(which, v, g) =>
          editLayers(
            history.trimLayer,
            paths,
            (l) => {
              if (which === 0) l.ip = roundTo(Math.min(v, l.op - 1), 3)
              else l.op = roundTo(Math.max(v, l.ip + 1), 3)
            },
            g,
          )
        }
      />
      <NumberRow
        label={tl.start}
        hint={tl.startHint}
        value={st}
        unit={t.common.framesShort}
        precision={2}
        onChange={(v, g) =>
          editLayers(history.moveLayer, paths, (l) => moveLayerInTime(l, v - (l.st ?? 0)), g)
        }
      />
      {allPrecomp && (
        <NumberRow
          label={tl.stretch}
          hint={tl.stretchHint}
          value={stretch === null ? null : roundTo(stretch * 100, 2)}
          unit="%"
          precision={1}
          min={1}
          max={10000}
          onChange={(v, g) =>
            editLayers(history.stretch, paths, (l) => setLayerStretch(l, v / 100), g)
          }
        />
      )}
      {ignoredStretch && (
        <Note className="pl-5">
          {tl.stretchIgnored(`${formatDecimal((stretch ?? stretchValues[0]) * 100, 1)}%`)}
        </Note>
      )}
      {allPrecomp && precomps.length > 0 && (
        <>
          <SwitchRow
            label={tl.timeRemap}
            hint={tl.timeRemapHint}
            checked={remap}
            onChange={(on) =>
              editLayers(on ? history.timeRemapOn : history.timeRemapOff, paths, (l) => {
                if (!isPrecompLayer(l)) return
                if (on) enableTimeRemap(l, fps)
                else disableTimeRemap(l)
              })
            }
          />
          {remap && (
            <ScalarProperty
              label={tl.sourceTime}
              hint={tl.timeRemapHint}
              targets={propTargets(paths, 'tm', times)}
              props={(layers as PrecompLayer[]).map((l) => l.tm)}
              unit={t.common.secondsShort}
              precision={3}
              step={0.01}
              scrubSpeed={1 / Math.max(1, fps)}
            />
          )}
        </>
      )}
      {/* Auto-orient follows the motion path, so it only matters for moving layers. */}
      {layers.some((l) => l.ao === 1 || isPositionAnimated(l)) && (
        <SwitchRow
          label={tl.autoOrient}
          hint={tl.autoOrientHint}
          checked={commonValue(layers.map((l) => l.ao === 1))}
          onChange={(on) =>
            editLayers(history.autoOrient, paths, (l) => void (on ? (l.ao = 1) : (l.ao = 0)))
          }
        />
      )}
    </Section>
  )
})

/** What the parent picker shows: the composition's layers (names, kinds and links). */
function parentSignature(doc: Animation | null, path: NodePath): string {
  const layers = doc ? getAt<Layer[]>(doc, compPathOf(path)) : undefined
  if (!Array.isArray(layers)) return ''
  return layers
    .map((l) => `${l.ind}\u0001${l.ty}\u0001${l.nm ?? ''}\u0001${l.parent ?? ''}`)
    .join('\u0002')
}

/**
 * Parent picker. Memoized on what it shows (not on the layers' transforms) so editing values
 * does not re-render a select that lists every layer of a big composition. Picking a parent
 * keeps the layer in place at the playhead, like After Effects.
 */
const ParentRow = memo(function ParentRow({ path }: { path: NodePath }) {
  const t = useT()
  const tl = t.inspector.layer
  const signature = useDocument((s) => parentSignature(s.doc, path))
  const { options, current } = useMemo(() => {
    const layers = signature ? getAt<Layer[]>(getDoc(), compPathOf(path)) : undefined
    const index = path[path.length - 1] as number
    const layer = layers?.[index]
    if (!layers || !layer) return { options: [], current: 'none' }
    const value =
      layer.parent === undefined ? 'none' : String(layers.findIndex((l) => l.ind === layer.parent))
    const list: SelectOption<string>[] = [
      { value: 'none', label: t.common.none },
      ...parentCandidates(layers, index).map((i) => ({
        value: String(i),
        label: layerDisplayName(layers[i], i, t),
        icon: KIND_OPTION_ICONS[layerKind(layers[i])],
        hint: String(i + 1),
      })),
    ]
    // A dangling parent reference (no layer with that ind) still shows as selected.
    if (value === '-1') list.push({ value: '-1', label: `#${layer.parent}`, disabled: true })
    return { options: list, current: value }
  }, [signature, path, t])

  const onChange = (v: string) => {
    const doc = getDoc()
    if (!doc) return
    // Compensate at the playhead, in the layer's composition time.
    const frame = compTimeFor(doc, path, Math.floor(usePlayback.getState().frame + 1e-6)).frame
    updateDoc(t.inspector.history.parent, (draft) => {
      const layers = getAt<Layer[]>(draft, compPathOf(path))
      if (layers)
        setParentKeepingPlace(
          layers,
          path[path.length - 1] as number,
          v === 'none' ? null : Number(v),
          frame,
        )
    })
  }

  if (options.length === 0) return null
  return (
    <SelectRow
      label={tl.parent}
      hint={tl.parentHint}
      value={current}
      options={options}
      onChange={onChange}
    />
  )
})

function isPositionAnimated(layer: Layer): boolean {
  const p = layer.ks?.p
  if (!p) return false
  return isSplitPosition(p) ? isAnimated(p.x) || isAnimated(p.y) : isAnimated(p)
}

function useFps(): number {
  const [fr] = useNodesAt<number>([['fr']])
  return typeof fr === 'number' && fr > 0 ? fr : 30
}

/** A label with clickable layer names (selects the layer). */
function LinkRow({
  label,
  items,
}: {
  label: string
  items: { path: NodePath; name: string; layer: Layer }[]
}) {
  return (
    <InspectorRow label={label}>
      <div className="flex min-w-0 flex-1 flex-wrap gap-x-1">
        {items.map((item) => {
          const Icon = KIND_OPTION_ICONS[layerKind(item.layer)] ?? Box
          return (
            <button
              key={item.path.join('/')}
              type="button"
              onClick={() => selectNodes([item.path])}
              className="group/link -ml-1 flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-md px-1 text-sm text-fg hover:bg-hover"
            >
              <Icon size={12} />
              <span className="truncate">{item.name}</span>
              <ArrowUpRight
                size={12}
                className="shrink-0 text-fg-faint group-hover/link:text-fg-muted"
              />
            </button>
          )
        })}
      </div>
    </InspectorRow>
  )
}
