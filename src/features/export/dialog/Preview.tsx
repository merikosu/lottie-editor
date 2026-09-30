/**
 * Live preview of the export: the animation at the output aspect ratio, on the chosen
 * background (checkerboard when transparent), playing at the output frame rate within the
 * exported range — or one still frame for frame exports.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { FrameRange } from '@/export/plan'
import type { Animation } from '@/lottie/types'
import { LottiePlayer } from '@/player/LottiePlayer'
import { usePrefs } from '@/store/prefs'

export type PreviewMode =
  | { kind: 'play'; range: FrameRange; compFps: number; fps: number }
  | { kind: 'still'; frame: number }

interface PreviewProps {
  doc: Animation | null
  /** Output size: the preview box takes its aspect ratio. */
  width: number
  height: number
  /** CSS color, or null for a checkerboard (transparent). */
  background: string | null
  mode: PreviewMode
  /** Stops playback (e.g. while exporting). */
  paused?: boolean
  /** Shown over the preview (e.g. a progress snapshot). */
  overlay?: ReactNode
  className?: string
  boxWidth?: number
  boxHeight?: number
}

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Frame shown `elapsed` ms into playback, stepping at the output rate like the exported file. */
function frameAt(mode: Extract<PreviewMode, { kind: 'play' }>, elapsed: number): number {
  const { range, compFps, fps } = mode
  const count = Math.max(1, Math.round(((range.end - range.start) / compFps) * fps))
  const index = Math.floor((elapsed / 1000) * fps) % count
  return range.start + (index * compFps) / fps
}

export function Preview({
  doc,
  width,
  height,
  background,
  mode,
  paused,
  overlay,
  className,
  boxWidth = 228,
  boxHeight = 204,
}: PreviewProps) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<LottiePlayer | null>(null)
  const modeRef = useRef(mode)
  const docRef = useRef(doc)
  /** Document the current player has loaded. */
  const loadedRef = useRef<Animation | null>(null)
  /** The current player's first load ran (it waits for the dialog to paint). */
  const startedRef = useRef(false)
  const runExpressions = usePrefs((s) => s.runExpressions)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    modeRef.current = mode
    docRef.current = doc
  })

  const load = (player: LottiePlayer, next: Animation | null) => {
    if (!next || loadedRef.current === next) return
    loadedRef.current = next
    const m = modeRef.current
    player.renderFrame(m.kind === 'still' ? m.frame : m.range.start)
    player.load(next)
  }

  // A player per expression setting; documents are loaded into it (double-buffered, no flash).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const player = new LottiePlayer(host, {
      renderer: 'svg',
      runExpressions,
      onError: () => setFailed(true),
      onReady: () => setFailed(false),
    })
    playerRef.current = player
    loadedRef.current = null
    startedRef.current = false
    // Building an animation is synchronous (about a second for a 5 MB file): let the dialog
    // appear first and fill the preview on the frame after it painted.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        raf = 0
        startedRef.current = true
        load(player, docRef.current)
      })
    })
    return () => {
      cancelAnimationFrame(raf)
      player.destroy()
      playerRef.current = null
      loadedRef.current = null
      startedRef.current = false
    }
    // `load` only touches refs.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [runExpressions])

  useEffect(() => {
    if (playerRef.current && startedRef.current) load(playerRef.current, doc)
    // oxlint-disable-next-line react/exhaustive-deps
  }, [doc])

  const playing = mode.kind === 'play' && !paused
  const stillFrame = mode.kind === 'still' ? mode.frame : null
  useEffect(() => {
    if (stillFrame !== null) {
      playerRef.current?.renderFrame(stillFrame)
      return
    }
    const m = modeRef.current
    if (m.kind !== 'play') return
    if (!playing || reducedMotion()) {
      playerRef.current?.renderFrame(m.range.start)
      return
    }
    let raf = 0
    let last = Number.NaN
    const start = performance.now()
    const tick = (now: number) => {
      const current = modeRef.current
      const player = playerRef.current
      if (current.kind === 'play' && player) {
        const frame = frameAt(current, now - start)
        if (frame !== last) {
          last = frame
          player.renderFrame(frame)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, stillFrame])

  // Fit the output aspect ratio into the box.
  const aspect = width > 0 && height > 0 ? width / height : 1
  const fitW = aspect >= boxWidth / boxHeight ? boxWidth : Math.round(boxHeight * aspect)
  const fitH = aspect >= boxWidth / boxHeight ? Math.round(boxWidth / aspect) : boxHeight

  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-md bg-canvas shadow-[inset_0_0_0_1px_var(--le-line)]',
        className,
      )}
      style={{ width: boxWidth + 24, height: boxHeight + 24 }}
      data-testid="export-preview"
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-[3px] shadow-[0_0_0_1px_var(--le-line-strong)]',
          !background && 'checkerboard',
        )}
        style={{
          width: Math.max(8, fitW),
          height: Math.max(8, fitH),
          background: background ?? undefined,
        }}
        title={t.export.previewLabel}
      >
        <div ref={hostRef} className={cn('absolute inset-0', failed && 'opacity-0')} aria-hidden />
      </div>
      {overlay}
    </div>
  )
}
