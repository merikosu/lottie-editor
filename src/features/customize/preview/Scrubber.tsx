import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { IconButton } from '@/components/ui'
import { useLanguage, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import {
  play,
  setFrame,
  stepFrames,
  subscribeFrame,
  togglePlay,
  usePlayback,
} from '@/store/playback'

const formats = new Map<string, Intl.NumberFormat>()

/** Seconds with two decimals in the UI language ("1.25" / "1,25"). */
function formatSeconds(seconds: number, language: string): string {
  let f = formats.get(language)
  if (!f) {
    f = new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    formats.set(language, f)
  }
  return f.format(Math.max(0, seconds))
}

/** Shift + arrows move ten frames (the native range input steps one). */
function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
  if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  e.preventDefault()
  stepFrames(e.key === 'ArrowLeft' ? -10 : 10)
}

/**
 * Timeline scrubber of the whole animation. A transparent native range input on top takes the
 * pointer and the keyboard (accessible for free); the drawn track, thumb and time follow the
 * playhead imperatively (no React render per frame). Dragging pauses and resumes playback.
 */
export function Scrubber({ className }: { className?: string }) {
  const t = useT()
  const language = useLanguage()
  const ip = useDocument((s) => s.doc?.ip ?? 0)
  const op = useDocument((s) => s.doc?.op ?? 1)
  const fr = useDocument((s) => s.doc?.fr ?? 30)
  const inputRef = useRef<HTMLInputElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const drag = useRef<{ resume: boolean } | null>(null)
  const last = Math.max(ip, Math.ceil(op) - 1)
  const total = `${formatSeconds((op - ip) / fr, language)} ${t.common.secondsShort}`

  useEffect(
    () =>
      subscribeFrame((frame) => {
        const ratio = last > ip ? Math.min(1, Math.max(0, (frame - ip) / (last - ip))) : 0
        const pct = `${ratio * 100}%`
        if (fillRef.current) fillRef.current.style.width = pct
        if (thumbRef.current) thumbRef.current.style.left = pct
        const input = inputRef.current
        if (input && !drag.current) input.value = String(Math.round(frame))
        if (timeRef.current)
          timeRef.current.textContent = `${formatSeconds((frame - ip) / fr, language)} / ${total}`
      }),
    [ip, last, fr, language, total],
  )

  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <div className="group relative flex h-6 min-w-0 flex-1 items-center">
        <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-line-strong">
          <div ref={fillRef} className="absolute inset-y-0 left-0 bg-accent" />
        </div>
        <div
          ref={thumbRef}
          className={cn(
            'pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white',
            'shadow-[0_0_0_1px_rgb(0_0_0/0.15),0_1px_3px_rgb(0_0_0/0.4)] transition-transform duration-100',
            'group-hover:scale-110 group-has-[input:focus-visible]:outline-2 group-has-[input:focus-visible]:outline-offset-2 group-has-[input:focus-visible]:outline-accent',
          )}
        />
        <input
          ref={inputRef}
          type="range"
          min={ip}
          max={last}
          step={1}
          defaultValue={ip}
          aria-label={t.customize.preview.scrubber}
          onPointerDown={() => {
            drag.current = { resume: usePlayback.getState().playing }
          }}
          onPointerUp={() => {
            const d = drag.current
            drag.current = null
            if (d?.resume) play()
          }}
          onInput={(e) => setFrame(Number(e.currentTarget.value))}
          onKeyDown={onKeyDown}
          data-testid="customize-scrubber"
          className="absolute inset-0 m-0 h-full w-full cursor-default opacity-0"
        />
      </div>
      <span
        ref={timeRef}
        className="w-[96px] shrink-0 text-right text-xs text-fg-subtle tabular-nums"
        aria-hidden
      />
    </div>
  )
}

/** Play / pause button bound to the playback store. */
export function PlayButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const t = useT()
  const playing = usePlayback((s) => s.playing)
  return (
    <IconButton
      icon={playing ? Pause : Play}
      label={playing ? t.customize.preview.pause : t.customize.preview.play}
      shortcut="space"
      size={size}
      onClick={togglePlay}
      data-testid="customize-play"
    />
  )
}
