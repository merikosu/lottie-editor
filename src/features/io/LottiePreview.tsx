import lottie, { type AnimationItem } from 'lottie-web'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { Animation } from '@/lottie/types'
import { scheduleFontProbeCleanup } from '@/player/font-probes'
import { prepareAnimationData } from '@/player/prepare'

export interface LottiePreviewProps {
  /** Animation data, or a loader called once the preview scrolls into view. */
  source: Animation | (() => Promise<Animation>)
  /** Still frame shown when not playing, as a fraction of the duration. */
  poster?: number
  /** Play in a loop (e.g. while the card is hovered). */
  playing?: boolean
  className?: string
}

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function showPoster(anim: AnimationItem, poster: number): void {
  anim.pause()
  const frames = Math.max(0, anim.totalFrames - 1)
  anim.goToAndStop(Math.round(frames * poster), true)
}

/**
 * Small live preview (lottie-web SVG renderer). The player is created lazily when the element
 * comes near the viewport and destroyed on unmount; it shows a still frame until `playing`.
 * Expressions never run here.
 */
export function LottiePreview({
  source,
  poster = 1 / 3,
  playing = false,
  className,
}: LottiePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)
  const playingRef = useRef(playing)
  const posterRef = useRef(poster)
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '160px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!visible || !host) return
    let cancelled = false
    let anim: AnimationItem | null = null
    const container = document.createElement('div')
    container.style.cssText = 'position:absolute;inset:0;'
    host.appendChild(container)
    void (async () => {
      try {
        const data = typeof source === 'function' ? await source() : source
        if (cancelled) return
        anim = lottie.loadAnimation({
          container,
          renderer: 'svg',
          loop: true,
          autoplay: false,
          animationData: prepareAnimationData(data),
          rendererSettings: {
            preserveAspectRatio: 'xMidYMid meet',
            progressiveLoad: false,
            hideOnTransparent: true,
            // Not in lottie-web's typings (5.13), but honoured by every renderer.
            runExpressions: false,
          } as never,
        })
        animRef.current = anim
        if (playingRef.current && !reducedMotion()) anim.play()
        else showPoster(anim, posterRef.current)
      } catch (err) {
        console.warn('Preview failed', err)
        if (!cancelled) setFailed(true)
      } finally {
        scheduleFontProbeCleanup()
      }
    })()
    return () => {
      cancelled = true
      anim?.destroy()
      animRef.current = null
      container.remove()
    }
  }, [visible, source])

  useEffect(() => {
    playingRef.current = playing
    posterRef.current = poster
    const anim = animRef.current
    if (!anim) return
    if (playing && !reducedMotion()) anim.play()
    else showPoster(anim, poster)
  }, [playing, poster])

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={cn('pointer-events-none relative', failed && 'opacity-0', className)}
    />
  )
}
