/**
 * Colors panel (right sidebar tab): every color and gradient in the document or selection,
 * replace-everywhere editing, merging, usages and global adjustments.
 */
import { Palette } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/ui'
import { useT } from '@/i18n'
import {
  readUsageColor,
  type ColorGroup,
  type ColorUsage,
  type GradientGroup,
  type GradientUsage,
} from '@/lottie/colors'
import { pathKey } from '@/lottie/path'
import { getDoc, useDocument } from '@/store/document'
import { AdjustSection } from './AdjustSection'
import { ColorEditPopover, type EditTarget } from './ColorEditor'
import { ColorList } from './ColorList'
import { ColorsToolbar } from './ColorsToolbar'
import { FlashMessage } from './FlashMessage'
import { colorRowKey, stopRowKey } from './format'
import { latestUsages, usePaletteGroups, useScopedColors, type PaletteGroups } from './useColorData'

/** Rows shown while a color is being edited, and the usages they were grouped from. */
type Snapshot = PaletteGroups & {
  docId: string | null
  colors: ColorUsage[]
  gradients: GradientUsage[]
}

export function ColorsPanel() {
  const t = useT()
  const hasDoc = useDocument((s) => s.doc !== null)
  const docId = useDocument((s) => s.meta?.id ?? null)
  const nodes = useDocument((s) => s.selection.nodes)
  const scoped = useScopedColors()

  // While a color is being edited (picker open, adjust drag), rows keep their order and
  // grouping; they still show live colors. Otherwise edited colors would jump or merge
  // under the pointer.
  const [frozenState, setFrozen] = useState<Snapshot | null>(null)
  const [editingState, setEditing] = useState<EditTarget | null>(null)
  // Opening another document ends any edit that belonged to the previous one.
  const editing = editingState && editingState.docId === docId ? editingState : null
  const frozen = frozenState && frozenState.docId === docId ? frozenState : null
  // Grouping from the frozen usages keeps the memo: no regrouping for every live edit.
  const live = usePaletteGroups(
    frozen?.colors ?? scoped.colors,
    frozen?.gradients ?? scoped.gradients,
  )
  const shown: PaletteGroups = frozen ?? live

  const freeze = () =>
    setFrozen((f) => f ?? { ...live, docId, colors: scoped.colors, gradients: scoped.gradients })
  const unfreeze = () => setFrozen(null)

  const editGroup = (group: ColorGroup) => {
    const doc = getDoc()
    const usages = latestUsages(group.usages)
    const [sample] = latestUsages([group.sample])
    if (!doc || usages.length === 0 || !sample) return
    const current = readUsageColor(doc, sample) ?? group.color
    freeze()
    setEditing({
      docId,
      key: colorRowKey(group),
      usages,
      sample,
      color: { ...current, a: 1 },
      alpha: false,
      title: t.colors.picker.replaceTitle,
      subtitle: t.colors.usesInLayers(group.count, group.layerCount),
      label: t.colors.history.replace,
    })
  }

  const editStop = (group: GradientGroup, index: number) => {
    const stop = group.sample.stops[index]
    if (!stop) return
    const doc = getDoc()
    const usages = latestUsages(group.usages.map((g) => g.stops[index]).filter(Boolean))
    const sample = usages.find((u) => u.id === stop.id) ?? usages[0]
    if (!doc || !sample) return
    const current = readUsageColor(doc, sample) ?? stop.color
    freeze()
    setEditing({
      docId,
      key: stopRowKey(group, index),
      usages,
      sample,
      color: current,
      alpha: usages.some((u) => u.alphaEditable),
      title: t.colors.picker.stopTitle(index + 1),
      subtitle: `${t.colors.usage.position(`${Math.round((stop.stopOffset ?? 0) * 100)}%`)} · ${t.colors.uses(group.count)}`,
      label: t.colors.history.stop,
    })
  }

  const closeEditor = () => {
    setEditing(null)
    unfreeze()
  }

  if (!hasDoc) return <EmptyState icon={Palette} title={t.common.noDocument} />

  const empty = shown.colorGroups.length === 0 && shown.gradientGroups.length === 0
  // First computation of a document still running in the background: show nothing rather
  // than a misleading "no colors".
  const loading = empty && scoped.pending
  const scopeKey = scoped.scope === 'document' ? 'document' : nodes.map(pathKey).join(',')

  return (
    <div className="flex h-full flex-col" data-testid="colors-panel">
      <ColorsToolbar
        scope={scoped.scope}
        hasSelection={scoped.hasSelection}
        usages={scoped.colors}
        colorGroups={shown.colorGroups}
        gradientGroups={shown.gradientGroups}
      />
      <div className="relative min-h-0 flex-1">
        {loading ? null : empty ? (
          scoped.scope === 'selection' ? (
            <EmptyState
              icon={Palette}
              title={t.colors.emptySelection.title}
              description={t.colors.emptySelection.description}
            />
          ) : (
            <EmptyState
              icon={Palette}
              title={t.colors.empty.title}
              description={t.colors.empty.description}
            />
          )
        ) : (
          <ColorList
            colorGroups={shown.colorGroups}
            gradientGroups={shown.gradientGroups}
            editingKey={editing?.key ?? null}
            onEditGroup={editGroup}
            onEditStop={editStop}
          />
        )}
        <FlashMessage />
      </div>
      {scoped.colors.length > 0 && (
        <AdjustSection
          usages={scoped.colors}
          scope={scoped.scope}
          scopeKey={scopeKey}
          onGestureStart={freeze}
          onGestureEnd={unfreeze}
        />
      )}
      <ColorEditPopover target={editing} onClose={closeEditor} />
    </div>
  )
}
