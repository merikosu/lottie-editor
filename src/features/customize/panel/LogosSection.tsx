import { Component, Image, ImageOff, Shapes, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { nodeDisplayName } from '@/components/lottie/labels'
import { Button, IconButton, Section } from '@/components/ui'
import { TruncatedText } from '@/features/io'
import { useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { pathEquals, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { selectNodes, updateDoc, useDocument } from '@/store/document'
import { setHoverNode, useUi } from '@/store/ui'
import { removeElement } from '../lib/remove'
import { useThumbnails, type ThumbnailRequest } from '../preview/thumbnails'
import { openReplace } from '../replace/open'
import { useCustomizeUi } from '../store'
import { Thumb } from './Thumb'
import { usePicked, useSuggestions, type ElementItem } from './useElements'

/** Rows shown before "Show all" (files with many images would bury the other sections). */
const COLLAPSED_ROWS = 5

function kindLabel(item: ElementItem, t: Dict): string {
  const kind = item.kind
    ? t.customize.logos.kinds[item.kind]
    : t.customize.logos.targets[item.target]
  return item.usage > 1 ? `${kind} · ${t.customize.logos.places(item.usage)}` : kind
}

const NO_SELECTION = { nodes: [], keyframes: [], property: null }

/** Takes the element out of the animation (one undo step). */
function remove(item: ElementItem, t: Dict): void {
  if (pathEquals(useUi.getState().hoverNode, item.path)) setHoverNode(null)
  updateDoc(
    t.customize.history.remove(item.name),
    (d) => {
      removeElement(d as Animation, item.path)
    },
    { selection: NO_SELECTION },
  )
}

function iconOf(item: ElementItem) {
  if (item.target === 'image-layer') return Image
  if (item.target === 'precomp-layer') return Component
  return Shapes
}

function ElementRow({
  item,
  thumb,
  selected,
  hovered,
  stale,
}: {
  item: ElementItem
  thumb?: string
  selected: boolean
  hovered: boolean
  /** The list is being recomputed after layers changed: its path may point elsewhere. */
  stale: boolean
}) {
  const t = useT()
  return (
    <li
      className={cn(
        'group flex h-11 items-center gap-1 rounded-md pr-1.5 transition-colors duration-100',
        selected ? 'bg-selected' : hovered ? 'bg-hover' : 'hover:bg-hover',
      )}
      onPointerEnter={() => setHoverNode(item.path)}
      onPointerLeave={() => {
        if (pathEquals(useUi.getState().hoverNode, item.path)) setHoverNode(null)
      }}
      data-testid="customize-element"
      data-selected={selected || undefined}
    >
      <button
        type="button"
        onClick={() => !stale && selectNodes([item.path])}
        onDoubleClick={() => !stale && openReplace(item.path)}
        aria-pressed={selected}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md pl-1 text-left"
      >
        <Thumb src={thumb} icon={iconOf(item)} />
        <span className="flex min-w-0 flex-1 flex-col">
          <TruncatedText text={item.name} className="text-sm text-fg" />
          <span className="truncate text-xs text-fg-subtle">{kindLabel(item, t)}</span>
        </span>
      </button>
      {/* Revealed with the row (hover or keyboard focus), like the row actions elsewhere. */}
      <IconButton
        icon={Trash2}
        label={t.customize.logos.removeNamed(item.name)}
        // Guarded rather than disabled: the stale moment lasts a frame and must not flash.
        onClick={() => !stale && remove(item, t)}
        className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        data-testid="customize-remove"
      />
      <Button
        size="sm"
        variant={selected ? 'secondary' : 'ghost'}
        onClick={() => !stale && openReplace(item.path)}
        aria-label={t.customize.logos.replaceNamed(item.name)}
        className={cn(!selected && 'text-fg-muted group-hover:bg-surface-2 group-hover:text-fg')}
        data-testid="customize-replace"
      >
        {t.customize.logos.replace}
      </Button>
    </li>
  )
}

/** Logos, images and graphics to swap (the replace engine's suggestions + the picked element). */
export function LogosSection() {
  const t = useT()
  const replacing = useCustomizeUi((s) => s.replacing)
  const { items, ready, stale, doc } = useSuggestions(replacing)
  const liveDoc = useDocument((s) => s.doc)
  const hoverNode = useUi((s) => s.hoverNode)
  const nameOf = useCallback((d: Animation, path: NodePath) => nodeDisplayName(d, path, t), [t])
  const picked = usePicked(doc, nameOf)

  const [expanded, setExpanded] = useState(false)
  const rows = useMemo(() => {
    if (!picked || items.some((i) => i.key === picked.key)) return items
    return [picked, ...items]
  }, [items, picked])
  const shown = useMemo(
    () => (expanded || rows.length <= COLLAPSED_ROWS + 1 ? rows : rows.slice(0, COLLAPSED_ROWS)),
    [rows, expanded],
  )
  const requests = useMemo<ThumbnailRequest[]>(
    () =>
      shown.flatMap((r) =>
        r.rootBounds && r.rootFrame !== null
          ? [{ key: r.key, frame: r.rootFrame, box: r.rootBounds }]
          : [],
      ),
    [shown],
  )
  const thumbs = useThumbnails(liveDoc, requests, replacing)

  return (
    <Section
      id="customize.logos"
      title={
        <>
          {t.customize.logos.title}
          {ready && rows.length > 0 && (
            <span className="ml-1.5 font-normal text-fg-subtle tabular-nums">{rows.length}</span>
          )}
        </>
      }
      contentClassName="gap-2"
    >
      {!ready ? (
        <div className="h-11" aria-busy />
      ) : rows.length === 0 ? (
        <div className="flex items-start gap-2.5 py-1">
          <Thumb icon={ImageOff} />
          <div className="min-w-0 pt-0.5">
            <div className="text-sm text-fg-muted">{t.customize.logos.empty}</div>
            <div className="text-xs text-fg-subtle">{t.customize.logos.emptyHint}</div>
          </div>
        </div>
      ) : (
        <>
          <ul className="-mx-1.5 flex flex-col" data-testid="customize-elements">
            {shown.map((item) => (
              <ElementRow
                key={item.key}
                item={item}
                thumb={thumbs.get(item.key)}
                selected={picked?.key === item.key}
                hovered={pathEquals(hoverNode, item.path)}
                stale={stale}
              />
            ))}
          </ul>
          {shown.length < rows.length || expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="self-start rounded-sm text-xs text-fg-subtle transition-colors duration-100 hover:text-fg"
            >
              {expanded ? t.customize.colors.showFewer : t.customize.colors.showAll(rows.length)}
            </button>
          ) : null}
          <p className="text-xs text-fg-subtle">{t.customize.logos.tip}</p>
        </>
      )}
    </Section>
  )
}
