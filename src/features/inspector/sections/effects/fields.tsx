/**
 * Effect parameter fields that pick from a list: popup menus (named options), layers of the
 * same composition (Set Matte, Layer Control) and masks of the layer (Fill, Stroke). All are
 * animatable in steps (hold keyframes), like in After Effects.
 */
import { useMemo } from 'react'
import { Select, type SelectOption } from '@/components/ui'
import { layerDisplayName } from '@/components/lottie/labels'
import { useT } from '@/i18n'
import { layerKind, nextLayerInd } from '@/lottie/layers'
import { compPathOf, getAt, type NodePath } from '@/lottie/path'
import type { AnyProperty } from '@/lottie/property'
import type { Animation, Layer, Mask } from '@/lottie/types'
import { getDoc, updateDoc, useDocument } from '@/store/document'
import { KIND_OPTION_ICONS } from '../../components/kind-icons'
import { PropertyRow } from '../../components/PropertyRow'
import { holdKeyframes, propertyAt, writeValue, type PropTarget } from '../../edit'
import { nameText } from '../../model/names'
import { commonNumber } from '../../model/values'

interface PickerProps {
  label: string
  hint?: string
  targets: PropTarget[]
  props: readonly (AnyProperty | null | undefined)[]
  fallback: number
  disabled?: boolean
}

/** The shared value of the targets, rounded (pickers hold whole numbers). */
function current(values: number[][]): number | null {
  const v = commonNumber(values.map((x) => Math.round(x[0] ?? 0)))
  return v === null ? null : v
}

/* -------------------------------------------------------------------------- */
/*                                    Menu                                    */
/* -------------------------------------------------------------------------- */

/** A popup menu parameter; the stored value is the 1-based option number. */
export function MenuProperty({
  options,
  ...row
}: PickerProps & {
  /** Options by value (1-based). */
  options: { value: number; label: string }[]
}) {
  const t = useT()
  return (
    <PropertyRow {...row} fallback={[row.fallback]} resettable discrete>
      {({ values, write }) => {
        const value = current(values)
        const list: SelectOption<string>[] = options.map((o) => ({
          value: String(o.value),
          label: o.label,
        }))
        // A value the menu doesn't know (newer After Effects, hand-edited files) stays visible.
        if (value !== null && !options.some((o) => o.value === value))
          list.push({
            value: String(value),
            label: t.inspector.effects.option(value),
            disabled: true,
          })
        return (
          <Select<string>
            value={value === null ? undefined : String(value)}
            placeholder={value === null ? t.common.mixed : undefined}
            options={list}
            onValueChange={(v) => write(() => Number(v))}
            disabled={row.disabled}
            aria-label={row.label}
            className="data-[disabled]:opacity-50"
          />
        )
      }}
    </PropertyRow>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Layer                                   */
/* -------------------------------------------------------------------------- */

/** What the layer list shows (names, kinds and indices), so value edits don't rebuild it. */
function layersSignature(doc: Animation | null, compPath: NodePath): string {
  const layers = doc ? getAt<Layer[]>(doc, compPath) : undefined
  if (!Array.isArray(layers)) return ''
  return layers.map((l) => `${l?.ind}\u0001${l?.ty}\u0001${l?.nm ?? ''}`).join('\u0002')
}

/**
 * A layer of the same composition, stored as the layer's `ind` (0 = none), as After Effects
 * layer controls are. Picking a layer without an `ind` gives it one in the same undo step.
 */
export function LayerProperty({ layerPath, ...row }: PickerProps & { layerPath: NodePath }) {
  const t = useT()
  const compPath = useMemo(() => compPathOf(layerPath), [layerPath])
  const signature = useDocument((s) => layersSignature(s.doc, compPath))
  const layerOptions = useMemo(() => {
    const layers = signature ? getAt<Layer[]>(getDoc(), compPath) : undefined
    if (!Array.isArray(layers)) return []
    return layers.map((layer, i) => ({
      value: typeof layer?.ind === 'number' ? `ind:${layer.ind}` : `at:${i}`,
      label: layerDisplayName(layer, i, t),
      icon: KIND_OPTION_ICONS[layerKind(layer)],
      hint: String(i + 1),
    }))
  }, [signature, compPath, t])

  const choose = (choice: string) => {
    const target = row.targets[0]
    if (!target) return
    updateDoc(t.inspector.history.change(row.label), (draft) => {
      let ind = 0
      if (choice.startsWith('ind:')) ind = Number(choice.slice(4))
      else if (choice.startsWith('at:')) {
        const layers = getAt<Layer[]>(draft, compPath)
        const layer = layers?.[Number(choice.slice(3))]
        if (!layers || !layer) return
        if (typeof layer.ind !== 'number') layer.ind = nextLayerInd(layers)
        ind = layer.ind
      }
      for (const tg of row.targets) {
        const prop = propertyAt(draft, tg.path)
        if (!prop) continue
        writeValue(prop, tg.frame, ind)
        holdKeyframes(prop)
      }
    })
  }

  return (
    <PropertyRow {...row} fallback={[row.fallback]} resettable discrete>
      {({ values }) => {
        const value = current(values)
        const selected = value === null ? undefined : value === 0 ? 'none' : `ind:${value}`
        const list: SelectOption<string>[] = [
          { value: 'none', label: t.common.none },
          ...layerOptions,
        ]
        if (selected && selected !== 'none' && !layerOptions.some((o) => o.value === selected))
          list.push({
            value: selected,
            label: t.inspector.effects.missingLayer(value ?? 0),
            disabled: true,
          })
        return (
          <Select<string>
            value={selected}
            placeholder={value === null ? t.common.mixed : undefined}
            options={list}
            onValueChange={choose}
            disabled={row.disabled}
            aria-label={row.label}
            className="data-[disabled]:opacity-50"
          />
        )
      }}
    </PropertyRow>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Mask                                    */
/* -------------------------------------------------------------------------- */

/** A mask of the effect's layer, 1-based (0 = none). */
export function MaskProperty({ layerPath, ...row }: PickerProps & { layerPath: NodePath }) {
  const t = useT()
  // A string (the mask names as JSON), so the selector result compares by value.
  const names = useDocument((s) => {
    const masks = s.doc ? getAt<Mask[]>(s.doc, [...layerPath, 'masksProperties']) : undefined
    return JSON.stringify(Array.isArray(masks) ? masks.map((m) => nameText(m?.nm)) : [])
  })
  const maskOptions = useMemo<SelectOption<string>[]>(
    () =>
      (JSON.parse(names) as string[]).map((nm, i) => ({
        value: String(i + 1),
        label: nm || t.inspector.masks.mask(i + 1),
      })),
    [names, t],
  )
  return (
    <PropertyRow {...row} fallback={[row.fallback]} resettable discrete>
      {({ values, write }) => {
        const value = current(values)
        const list: SelectOption<string>[] = [{ value: '0', label: t.common.none }, ...maskOptions]
        if (value !== null && value !== 0 && !maskOptions.some((o) => o.value === String(value)))
          list.push({
            value: String(value),
            label: t.inspector.effects.missingMask(value),
            disabled: true,
          })
        return (
          <Select<string>
            value={value === null ? undefined : String(value)}
            placeholder={value === null ? t.common.mixed : undefined}
            options={list}
            onValueChange={(v) => write(() => Number(v))}
            disabled={row.disabled}
            aria-label={row.label}
            className="data-[disabled]:opacity-50"
          />
        )
      }}
    </PropertyRow>
  )
}
