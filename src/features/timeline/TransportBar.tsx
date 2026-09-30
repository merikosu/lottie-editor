/**
 * Timeline header: transport (start, step, play/pause, end), play mode, preview speed, time
 * display, snapping, markers and zoom.
 */
import {
  ArrowLeftRight,
  ArrowRightToLine,
  BookmarkPlus,
  ChartSpline,
  ChevronDown,
  Magnet,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  UnfoldHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { memo } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  NumberField,
  Slider,
  Tooltip,
} from '@/components/ui'
import { primaryShortcut, useCommand } from '@/commands/registry'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatDecimal, formatTimecode } from '@/lib/format'
import { isMac } from '@/lib/platform'
import { lastFrame } from '@/lottie/time'
import { useDocument } from '@/store/document'
import {
  SPEEDS,
  cyclePlayMode,
  goToEnd,
  goToStart,
  setFrame,
  setSpeed,
  stepFrames,
  togglePlay,
  useIntegerFrame,
  usePlayback,
  type PlayMode,
} from '@/store/playback'
import { addMarkerAt, toggleGraph } from './actions'
import { useController, useMetrics } from './context'
import { ppfToSlider, sliderToPpf, zoomLimits } from './geometry'
import { setTimelinePrefs, useTimelinePrefs, type TimeUnits } from './store'

const MODE_ICONS: Record<PlayMode, LucideIcon> = {
  loop: Repeat,
  once: ArrowRightToLine,
  bounce: ArrowLeftRight,
}

function Divider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-line-strong" aria-hidden />
}

/** Shortcut of a registered command (so tooltips stay in sync with the registry). */
function useShortcut(id: string): string | undefined {
  return primaryShortcut(useCommand(id))
}

function TransportButtons() {
  const t = useT()
  const playing = usePlayback((s) => s.playing)
  const startKey = useShortcut('playback.start')
  const prevKey = useShortcut('playback.prevFrame')
  const toggleKey = useShortcut('playback.toggle')
  const nextKey = useShortcut('playback.nextFrame')
  const endKey = useShortcut('playback.end')
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton
        size="md"
        icon={SkipBack}
        label={t.commands.goToStart}
        shortcut={startKey}
        onClick={goToStart}
      />
      <IconButton
        size="md"
        icon={StepBack}
        label={t.commands.prevFrame}
        shortcut={prevKey}
        onClick={() => stepFrames(-1)}
      />
      <IconButton
        size="md"
        icon={playing ? Pause : Play}
        label={playing ? t.timeline.transport.pause : t.timeline.transport.play}
        shortcut={toggleKey}
        onClick={togglePlay}
        data-testid="timeline-play"
      />
      <IconButton
        size="md"
        icon={StepForward}
        label={t.commands.nextFrame}
        shortcut={nextKey}
        onClick={() => stepFrames(1)}
      />
      <IconButton
        size="md"
        icon={SkipForward}
        label={t.commands.goToEnd}
        shortcut={endKey}
        onClick={goToEnd}
      />
    </div>
  )
}

function PlayModeButton() {
  const t = useT()
  const mode = usePlayback((s) => s.mode)
  const shortcut = useShortcut('playback.cycleMode')
  const names: Record<PlayMode, string> = {
    loop: t.commands.modeLoop,
    once: t.commands.modeOnce,
    bounce: t.commands.modeBounce,
  }
  return (
    <IconButton
      size="md"
      icon={MODE_ICONS[mode]}
      label={t.timeline.transport.playMode(names[mode])}
      shortcut={shortcut}
      onClick={cyclePlayMode}
    />
  )
}

function formatSpeed(speed: number): string {
  return `${formatDecimal(speed, 2)}×`
}

function SpeedMenu() {
  const t = useT()
  const speed = usePlayback((s) => s.speed)
  const custom = speed !== 1
  return (
    <DropdownMenu>
      <Tooltip content={t.timeline.transport.speed}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t.timeline.transport.speed}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md pr-1 pl-1.5 text-sm font-medium tabular-nums transition-colors duration-100',
              'hover:bg-hover data-[state=open]:bg-hover',
              custom
                ? 'bg-accent-subtle text-accent-text hover:bg-accent-subtle'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {formatSpeed(speed)}
            <ChevronDown size={12} className="opacity-60" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent className="min-w-[216px]">
        <MenuLabel>{t.timeline.transport.speed}</MenuLabel>
        <div className="px-2 pb-1.5 text-xs text-fg-subtle">{t.timeline.transport.speedNote}</div>
        <MenuSeparator />
        <MenuRadioGroup value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
          {SPEEDS.map((s) => (
            <MenuRadioItem key={s} value={String(s)}>
              <span className="tabular-nums">{formatSpeed(s)}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UnitsToggle() {
  const t = useT()
  const units = useTimelinePrefs((s) => s.units)
  const option = (value: TimeUnits, label: string, title: string) => (
    <Tooltip content={title}>
      <button
        type="button"
        aria-pressed={units === value}
        aria-label={title}
        onClick={() => setTimelinePrefs({ units: value })}
        className={cn(
          'inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-xs font-medium transition-colors duration-100',
          units === value
            ? 'bg-surface-1 text-fg shadow-thumb dark:bg-surface-3'
            : 'text-fg-subtle hover:text-fg',
        )}
      >
        {label}
      </button>
    </Tooltip>
  )
  return (
    <fieldset
      aria-label={t.timeline.transport.units}
      className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md bg-surface-2 p-0.5"
    >
      {option('frames', t.common.framesShort, t.timeline.transport.frames)}
      {option('seconds', t.common.secondsShort, t.timeline.transport.seconds)}
    </fieldset>
  )
}

function TimeDisplay() {
  const t = useT()
  const frame = useIntegerFrame()
  const doc = useDocument((s) => s.doc)
  if (!doc) return null
  const last = lastFrame(doc)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <NumberField
          value={frame}
          onChange={(v) => setFrame(v)}
          min={doc.ip}
          max={last}
          step={1}
          precision={0}
          scrubSpeed={0.5}
          aria-label={t.timeline.transport.currentFrame}
          className="w-14"
          inputClassName="text-right font-medium"
        />
        <Tooltip content={t.timeline.transport.lastFrame}>
          <span className="text-sm text-fg-subtle tabular-nums">/ {last}</span>
        </Tooltip>
      </div>
      <Tooltip content={t.timeline.transport.currentTime}>
        <span className="hidden shrink-0 text-sm text-fg-subtle tabular-nums @[560px]:inline">
          {formatTimecode(frame - doc.ip, doc.fr)}
        </span>
      </Tooltip>
      <Tooltip content={t.timeline.transport.frameRate}>
        <span className="hidden shrink-0 text-xs text-fg-faint tabular-nums @[640px]:inline">
          {formatDecimal(doc.fr, 2)} {t.common.fps}
        </span>
      </Tooltip>
      <UnitsToggle />
    </div>
  )
}

function ZoomControls() {
  const t = useT()
  const ctl = useController()
  const m = useMetrics()
  const limits = zoomLimits(m.viewWidth, m.ip, m.op)
  const value = ppfToSlider(m.ppf, limits)
  const atMin = m.ppf <= limits.min * 1.001
  const atMax = m.ppf >= limits.max * 0.999
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton
        icon={Minus}
        label={t.timeline.transport.zoomOut}
        disabled={atMin}
        onClick={() => ctl.zoomBy(1 / 1.5)}
      />
      <Slider
        value={value}
        min={0}
        max={100}
        step={0.5}
        onChange={(v) => ctl.zoomTo(sliderToPpf(v, limits))}
        aria-label={t.timeline.transport.zoom}
        className="hidden w-20 px-1 @[520px]:flex"
      />
      <IconButton
        icon={Plus}
        label={t.timeline.transport.zoomIn}
        disabled={atMax}
        onClick={() => ctl.zoomBy(1.5)}
      />
      <IconButton
        icon={UnfoldHorizontal}
        label={t.timeline.transport.zoomFit}
        disabled={atMin}
        onClick={() => ctl.zoomFit()}
      />
    </div>
  )
}

/** Keyframe tracks ⇄ graph editor. */
function GraphToggle() {
  const t = useT()
  const graph = useTimelinePrefs((s) => s.graph)
  const shortcut = useShortcut('timeline.toggleGraph')
  return (
    <IconButton
      icon={ChartSpline}
      label={t.timeline.graph.title}
      shortcut={shortcut}
      active={graph}
      onClick={() => toggleGraph()}
      data-testid="timeline-graph-toggle"
    />
  )
}

function SnapToggle() {
  const t = useT()
  const snapping = useTimelinePrefs((s) => s.snapping)
  return (
    <IconButton
      icon={Magnet}
      label={
        snapping
          ? t.timeline.transport.snappingOn(isMac ? '⌘' : 'Ctrl')
          : t.timeline.transport.snappingOff
      }
      active={snapping}
      onClick={() => setTimelinePrefs({ snapping: !snapping })}
    />
  )
}

export const TransportBar = memo(function TransportBar() {
  const t = useT()
  const markerKey = useShortcut('anim.addMarker')
  return (
    <div className="@container flex h-8 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
      <TransportButtons />
      <Divider />
      <PlayModeButton />
      <SpeedMenu />
      <Divider />
      <TimeDisplay />
      <div className="min-w-2 flex-1" />
      <GraphToggle />
      <SnapToggle />
      <IconButton
        icon={BookmarkPlus}
        label={t.timeline.transport.addMarker}
        shortcut={markerKey}
        onClick={() => addMarkerAt()}
      />
      <Divider />
      <ZoomControls />
    </div>
  )
})
