/**
 * Header row above the tracks: the names-column corner, the ruler (canvas ticks + work area)
 * and the marker lane.
 */
import { ListChevronsDownUp, ListChevronsUpDown } from 'lucide-react'
import { memo, useRef, type KeyboardEvent } from 'react'
import { IconButton, Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { markerDuration, markerName, renameMarker } from '@/lottie/markers'
import type { Marker } from '@/lottie/types'
import { updateDoc, useDocument } from '@/store/document'
import { usePlayback } from '@/store/playback'
import { addMarkerAt, revealAnimatedProperties } from './actions'
import { useController, useMetrics } from './context'
import { frameToX, MARKER_LANE_H, RULER_H } from './geometry'
import { setTimelineView, useTimelineView } from './store'

const collapseAll = () => setTimelineView({ expanded: {} })

/** Cheap "is anything expanded" (runs on every view-store update). */
function hasAny(record: Record<string, boolean>): boolean {
  for (const key in record) if (record[key]) return true
  return false
}

function Corner({ layerCount }: { layerCount: number }) {
  const t = useT()
  const { namesWidth } = useMetrics()
  const expandedAny = useTimelineView((s) => hasAny(s.expanded))
  return (
    <div className="flex shrink-0 flex-col border-r border-line" style={{ width: namesWidth }}>
      <div className="flex items-center gap-0.5 pr-1 pl-3" style={{ height: RULER_H }}>
        <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle tabular-nums">
          {t.timeline.layerCount(layerCount)}
        </span>
        <IconButton
          size="xs"
          icon={ListChevronsUpDown}
          label={t.timeline.header.revealAnimated}
          shortcut="u"
          onClick={revealAnimatedProperties}
        />
        <IconButton
          size="xs"
          icon={ListChevronsDownUp}
          label={t.timeline.header.collapseAll}
          disabled={!expandedAny}
          onClick={collapseAll}
        />
      </div>
      <div
        className="flex items-center justify-end border-t border-line-subtle pr-3 text-2xs text-fg-faint select-none"
        style={{ height: MARKER_LANE_H }}
      >
        {t.timeline.header.markers}
      </div>
    </div>
  )
}

function WorkAreaBar() {
  const t = useT()
  const ctl = useController()
  const { ip, op, ppf } = useMetrics()
  const workArea = usePlayback((s) => s.workArea)
  const start = workArea ? Math.max(ip, workArea.start) : ip
  const end = workArea ? Math.min(op, workArea.end) : op
  const left = frameToX(start, ip, ppf)
  const right = frameToX(end, ip, ppf)
  const active = workArea !== null
  return (
    <div
      className="group/wa absolute top-0 h-[7px]"
      style={{ left, width: Math.max(1, right - left) }}
      data-ctx="workarea"
      onDoubleClick={(e) => {
        e.stopPropagation()
        usePlayback.setState({ workArea: null })
      }}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 bottom-[2px] cursor-grab rounded-b-[2px] transition-colors duration-100',
          active ? 'bg-accent-subtle hover:bg-accent/30' : 'bg-transparent group-hover/wa:bg-hover',
        )}
        onPointerDown={(e) => ctl.onWorkAreaPointerDown(e, 'body')}
      />
      {(['start', 'end'] as const).map((part) => (
        <Tooltip
          key={part}
          content={part === 'start' ? t.commands.setWorkStart : t.commands.setWorkEnd}
          side="top"
        >
          <div
            className={cn(
              'absolute top-0 flex h-full w-2 cursor-ew-resize justify-center',
              part === 'start' ? '-left-1' : '-right-1',
            )}
            onPointerDown={(e) => ctl.onWorkAreaPointerDown(e, part)}
          >
            <span
              className={cn(
                'h-full w-[3px] rounded-b-[1px] transition-colors duration-100',
                active ? 'bg-accent' : 'bg-fg-faint opacity-0 group-hover/wa:opacity-100',
              )}
            />
          </div>
        </Tooltip>
      ))}
    </div>
  )
}

function Ruler() {
  const ctl = useController()
  const { contentWidth } = useMetrics()
  return (
    <div
      className="relative cursor-default overflow-hidden"
      style={{ height: RULER_H }}
      data-ctx="ruler"
      onPointerDown={(e) => ctl.onRulerPointerDown(e)}
    >
      <canvas
        ref={(el) => ctl.attachCanvas(el)}
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden
      />
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: contentWidth, transform: 'translateX(var(--sx))' }}
      >
        <WorkAreaBar />
      </div>
    </div>
  )
}

function MarkerRename({ marker, index }: { marker: Marker; index: number }) {
  const t = useT()
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    setTimelineView({ renamingMarker: null })
    const name = value?.trim()
    if (value === null || name === undefined || name === markerName(marker)) return
    updateDoc(t.timeline.history.renameMarker, (d) => renameMarker(d, index, name))
  }
  return (
    <input
      autoFocus
      aria-label={t.timeline.rows.renameMarker}
      defaultValue={markerName(marker)}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="absolute top-0 left-2 z-10 h-4 w-40 rounded-sm bg-surface-2 px-1 text-2xs text-fg shadow-[inset_0_0_0_1px_var(--le-accent)] outline-none"
    />
  )
}

function MarkerItem({
  marker,
  index,
  next,
}: {
  marker: Marker
  index: number
  next: number | null
}) {
  const ctl = useController()
  const { ip, ppf, contentWidth } = useMetrics()
  const renaming = useTimelineView((s) => s.renamingMarker === index)
  const x = frameToX(marker.tm, ip, ppf)
  const dr = markerDuration(marker)
  const endX = frameToX(marker.tm + dr, ip, ppf)
  const limit = next === null ? contentWidth : frameToX(next, ip, ppf)
  const name = markerName(marker)
  // Labels may run to the next marker (or to the end of their own range).
  const labelWidth = Math.max(
    0,
    Math.max(dr > 0 ? endX : limit, Math.min(limit, contentWidth)) - x - 14,
  )
  return (
    <div
      className="group/marker absolute inset-y-0"
      style={{ left: x }}
      data-ctx="marker"
      data-index={index}
    >
      {dr > 0 && (
        <>
          <div
            className="pointer-events-none absolute inset-y-[2px] left-0 rounded-[3px] bg-hover group-hover/marker:bg-pressed"
            style={{ width: Math.max(0, endX - x - 1) }}
          />
          <div
            className="absolute top-0 h-full w-2 -translate-x-full cursor-ew-resize"
            style={{ left: endX - x }}
            onPointerDown={(e) => ctl.onMarkerPointerDown(e, index, 'end')}
          >
            <span className="absolute top-1/2 right-[2px] h-2 w-[2px] -translate-y-1/2 rounded-full bg-fg-faint group-hover/marker:bg-fg-subtle" />
          </div>
        </>
      )}
      <div
        className="absolute top-0 flex h-full cursor-ew-resize items-center"
        style={{ maxWidth: labelWidth + 12 }}
        onPointerDown={(e) => ctl.onMarkerPointerDown(e, index, 'flag')}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setTimelineView({ renamingMarker: index })
        }}
      >
        <svg
          width="7"
          height="12"
          viewBox="0 0 7 12"
          className="-ml-px shrink-0 overflow-visible"
          aria-hidden
        >
          <path
            d="M0.5 0 V12"
            className="stroke-fg-subtle group-hover/marker:stroke-fg"
            strokeWidth={1}
          />
          <path
            d="M0.5 1 H6 L4.4 3.25 L6 5.5 H0.5 Z"
            className="fill-fg-subtle group-hover/marker:fill-fg"
          />
        </svg>
        {!renaming && labelWidth > 14 && (
          <span
            className="truncate pl-1 text-2xs leading-[14px] text-fg-muted group-hover/marker:text-fg"
            style={{ maxWidth: labelWidth }}
          >
            {name}
          </span>
        )}
      </div>
      {renaming && <MarkerRename marker={marker} index={index} />}
    </div>
  )
}

function MarkerLane() {
  const ctl = useController()
  const { contentWidth } = useMetrics()
  // Select the raw field: getMarkers() returns a fresh [] for files without markers.
  const markers = useDocument((s) => s.doc?.markers)
  const sorted = (Array.isArray(markers) ? markers : [])
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.tm - b.m.tm)
  return (
    <div
      className="relative overflow-hidden border-t border-line-subtle"
      style={{ height: MARKER_LANE_H }}
      data-ctx="markers"
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.lane === 'inner') {
          addMarkerAt(Math.round(ctl.clientXToFrame(e.clientX)))
        }
      }}
    >
      <div
        data-lane="inner"
        className="absolute inset-y-0 left-0"
        style={{ width: contentWidth, transform: 'translateX(var(--sx))' }}
      >
        {sorted.map(({ m, i }, order) => (
          <MarkerItem key={i} marker={m} index={i} next={sorted[order + 1]?.m.tm ?? null} />
        ))}
      </div>
    </div>
  )
}

export const Header = memo(function Header({ layerCount }: { layerCount: number }) {
  const { scrollbar } = useMetrics()
  return (
    <div className="flex shrink-0 border-b border-line bg-surface-1">
      <Corner layerCount={layerCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Ruler />
        <MarkerLane />
      </div>
      <div className="shrink-0" style={{ width: scrollbar }} />
    </div>
  )
})
