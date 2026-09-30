/**
 * Easing preview: spacing dots at equal time steps (bunched where the motion is slow) and a
 * dot that loops along with the easing. The dot stays still for reduced motion.
 */
import { useEffect, useRef } from 'react'
import { cubicBezier, type BezierCurve } from '@/lottie/easing'
import { clamp } from '@/lib/math'

const STEPS = 12
const DURATION = 1100
const PAUSE = 450

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

export function EasingPreview({ curve, hold }: { curve: BezierCurve; hold: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const ease = hold
    ? (x: number) => (x >= 1 ? 1 : 0)
    : cubicBezier(curve[0], curve[1], curve[2], curve[3])
  const positions = Array.from({ length: STEPS + 1 }, (_, i) => clamp(ease(i / STEPS), -0.15, 1.15))
  const key = hold ? 'hold' : curve.join(',')

  useEffect(() => {
    const dot = dotRef.current
    const track = trackRef.current
    if (!dot || !track || prefersReducedMotion()) return
    const fn = hold
      ? (x: number) => (x >= 1 ? 1 : 0)
      : cubicBezier(...(key.split(',').map(Number) as BezierCurve))
    let frame = 0
    let visible = true
    const start = performance.now()
    const tick = (now: number) => {
      const t = ((now - start) % (DURATION + PAUSE)) / DURATION
      dot.style.transform = `translateX(${clamp(fn(Math.min(1, t)), -0.15, 1.15) * 100}%)`
      frame = visible ? requestAnimationFrame(tick) : 0
    }
    // Pause while the editor is scrolled out of view.
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible && !frame) frame = requestAnimationFrame(tick)
    })
    io.observe(track)
    frame = requestAnimationFrame(tick)
    return () => {
      io.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [key, hold])

  return (
    <div ref={trackRef} className="relative mx-3 h-3" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
      {positions.map((p, i) => (
        <span
          key={i}
          className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-faint"
          style={{ left: `${p * 100}%` }}
        />
      ))}
      <div
        ref={dotRef}
        className="absolute inset-y-0 left-0 w-full"
        style={{ transform: 'translateX(0%)' }}
      >
        <span className="absolute top-1/2 left-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_2px_var(--le-surface-1)]" />
      </div>
    </div>
  )
}
