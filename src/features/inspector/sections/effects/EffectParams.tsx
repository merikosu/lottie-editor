/**
 * The parameters of one effect as animatable rows. Known effects show friendly labels (by
 * match name, so files from a localized After Effects read the same), units, named menu
 * options and layer/mask pickers; parameters no player reads are tucked away at the end.
 */
import { ChevronRight } from 'lucide-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { paramDefault, type EffectContext, type EffectDef, type ParamValue } from '@/lottie/effects'
import { pathFromKey, pathKey, type NodePath } from '@/lottie/path'
import { evaluateArray, type AnyProperty } from '@/lottie/property'
import type { Effect } from '@/lottie/types'
import {
  ColorProperty,
  ScalarProperty,
  SwitchProperty,
  VectorProperty,
} from '../../components/fields'
import { useNodesAt } from '../../hooks'
import { effectModel, type EffectParam } from '../../model/effects'
import type { CompTime } from '../../model/time'
import { LayerProperty, MaskProperty, MenuProperty } from './fields'

interface EffectParamsProps {
  effect: Effect
  effectPath: NodePath
  layerPath: NodePath
  time: CompTime
  /** Defaults that depend on the layer (Transform effect pivot, stroked masks). */
  context: EffectContext
}

/** Value of a checkbox parameter at the frame (players compare against 1). */
function isOn(prop: AnyProperty | undefined, frame: number): boolean {
  return !!prop && Math.round(evaluateArray(prop, frame)[0] ?? 0) === 1
}

export function EffectParams({ effect, effectPath, layerPath, time, context }: EffectParamsProps) {
  const t = useT()
  const te = t.inspector.effects
  const pathId = pathKey(effectPath)
  const model = useMemo(() => effectModel(effect, pathFromKey(pathId)), [effect, pathId])
  const props = useNodesAt<AnyProperty>(model.params.map((p) => p.path))
  const [showUnused, setShowUnused] = useState(false)
  if (model.params.length === 0) return null

  const def = model.def
  // Checkbox parameters other parameters depend on (Uniform scale, All masks).
  const onById = new Map<string, boolean>()
  model.params.forEach((p, i) => {
    if (p.def?.ui.kind === 'checkbox') onById.set(p.def.id, isOn(props[i], time.frame))
  })

  const rows = model.params.map((p, i) => ({ p, prop: props[i] }))
  const used = rows.filter((r) => !r.p.unused)
  const unused = rows.filter((r) => r.p.unused)

  const renderRow = ({ p, prop }: { p: EffectParam; prop: AnyProperty | undefined }) => {
    if (p.def?.hiddenBy && onById.get(p.def.hiddenBy)) return null
    return (
      <ParamRow
        key={pathKey(p.path)}
        param={p}
        prop={prop}
        def={def}
        layerPath={layerPath}
        time={time}
        context={context}
        disabled={!!p.def?.disabledBy && !!onById.get(p.def.disabledBy)}
        // After Effects shows "Scale" alone while the scale is uniform.
        labelKey={p.def?.id === 'scaleHeight' && onById.get('uniformScale') ? 'scale' : p.def?.id}
      />
    )
  }

  return (
    <div
      className={cn('flex flex-col gap-1.5', effect.en === 0 && 'opacity-60')}
      data-testid="effect-params"
    >
      <Grouped rows={used} render={renderRow} />
      {unused.length > 0 && (
        <>
          <Tooltip content={te.unusedHint} side="left">
            <button
              type="button"
              aria-expanded={showUnused}
              onClick={() => setShowUnused(!showUnused)}
              className="group/unused -ml-0.5 flex h-6 w-fit min-w-0 items-center gap-1 rounded-sm pr-1 text-xs text-fg-subtle hover:text-fg-muted"
            >
              <span className="flex w-4 shrink-0 justify-center">
                <ChevronRight
                  size={12}
                  className={cn('transition-transform duration-100', showUnused && 'rotate-90')}
                />
              </span>
              <span className="truncate">{te.unused}</span>
              <span className="text-fg-faint tabular-nums">{unused.length}</span>
            </button>
          </Tooltip>
          {showUnused && <Grouped rows={unused} render={renderRow} />}
        </>
      )}
    </div>
  )
}

/** Rows with a heading line wherever the (nested) group changes. */
function Grouped<R extends { p: EffectParam }>({
  rows,
  render,
}: {
  rows: R[]
  render: (row: R) => ReactNode
}) {
  const groupOf = (i: number) => rows[i]?.p.groups.join(' › ') ?? ''
  return rows.map((row, i) => {
    const heading = groupOf(i) && groupOf(i) !== groupOf(i - 1) ? groupOf(i) : null
    return (
      <Fragment key={pathKey(row.p.path)}>
        {heading && <div className="truncate pt-0.5 pl-5 text-xs text-fg-subtle">{heading}</div>}
        {render(row)}
      </Fragment>
    )
  })
}

interface ParamRowProps {
  param: EffectParam
  prop: AnyProperty | undefined
  def: EffectDef | null
  layerPath: NodePath
  time: CompTime
  context: EffectContext
  disabled: boolean
  labelKey: string | undefined
}

function ParamRow({
  param,
  prop,
  def,
  layerPath,
  time,
  context,
  disabled,
  labelKey,
}: ParamRowProps) {
  const t = useT()
  const te = t.inspector.effects
  const friendly = def && labelKey ? te.params[def.kind]?.[labelKey] : undefined
  const label = friendly || param.name || te.controlKinds[param.kind]
  // The name in the file matters to expressions: show it when a localized After Effects (or
  // someone) named the control differently.
  const exported =
    friendly && param.name && param.def && param.name !== param.def.nm
      ? te.exportedName(param.name)
      : undefined
  const hint = exported ?? (param.kind === 'dropdown' && !param.def ? te.dropdownHint : undefined)
  const fallback: ParamValue | undefined = param.def ? paramDefault(param.def, context) : undefined
  const row = {
    label,
    hint,
    targets: [{ path: param.path, frame: time.frame, toRoot: time.toRoot }],
    props: [prop],
    disabled,
    resettable: fallback !== undefined,
  }
  const scalar = typeof fallback === 'number' ? fallback : 0
  const ui = param.ui

  switch (ui.kind) {
    case 'number':
      return (
        <ScalarProperty
          {...row}
          fallback={scalar}
          unit={ui.unit}
          scale={ui.scale}
          precision={ui.precision ?? 1}
          min={ui.min}
          max={ui.max}
        />
      )
    case 'angle':
      return <ScalarProperty {...row} fallback={scalar} unit="°" precision={1} />
    case 'color':
      return <ColorProperty {...row} fallback={Array.isArray(fallback) ? fallback : [0, 0, 0, 1]} />
    case 'point':
      return (
        <VectorProperty
          {...row}
          dims={ui.dims}
          fallback={Array.isArray(fallback) ? fallback : Array.from({ length: ui.dims }, () => 0)}
        />
      )
    case 'checkbox':
      return <SwitchProperty {...row} fallback={scalar} />
    case 'menu': {
      const labels = def && param.def ? te.options[`${def.kind}.${param.def.id}`] : undefined
      const options = ui.options.map((value) => ({
        value,
        label: labels?.[value - 1] ?? te.option(value),
      }))
      return <MenuProperty {...row} fallback={scalar || 1} options={options} />
    }
    case 'layer':
      return <LayerProperty {...row} fallback={scalar} layerPath={layerPath} />
    case 'mask':
      return <MaskProperty {...row} fallback={scalar} layerPath={layerPath} />
  }
}
