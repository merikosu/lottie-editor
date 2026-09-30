/**
 * Imperative wrapper around lottie-web used by every live view (viewport, compare view).
 *
 * - Rendering is driven externally: call `renderFrame(frame)` with an absolute frame of the
 *   root composition; the player never plays by itself.
 * - Reloads are double-buffered: a new animation instance is built in a hidden layer and
 *   swapped in once it has rendered, so edits never flash an empty canvas.
 */
import lottie, { type AnimationItem } from 'lottie-web'
import type { NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import type { RendererType } from '@/store/prefs'
import { scheduleFontProbeCleanup } from './font-probes'
import { prepareAnimationData } from './prepare'

export interface LottiePlayerOptions {
  renderer: RendererType
  /**
   * Evaluate After Effects expressions. Expressions are arbitrary JavaScript executed with
   * eval() in the app's origin, so this is off unless the user explicitly enables it.
   */
  runExpressions?: boolean
  /** Tag layers/shape groups with path classes for hit-testing (SVG only). */
  tagNodes?: boolean
  /** Preview-only solo (see prepareAnimationData). */
  solo?: NodePath[]
  /** Called when a load fails (bad data). */
  onError?: (error: Error) => void
  /** Called after a (re)load has been swapped in and rendered. */
  onReady?: () => void
}

interface Instance {
  anim: AnimationItem
  el: HTMLDivElement
}

export class LottiePlayer {
  private readonly host: HTMLElement
  private opts: LottiePlayerOptions
  private active: Instance | null = null
  private pending: (Instance & { token: number; cleanup: () => void }) | null = null
  private token = 0
  private frame = 0
  private destroyed = false

  constructor(host: HTMLElement, opts: LottiePlayerOptions) {
    this.host = host
    this.opts = opts
  }

  get renderer(): RendererType {
    return this.opts.renderer
  }

  /** The live lottie-web instance (null until the first load completes). */
  get animation(): AnimationItem | null {
    return this.active?.anim ?? null
  }

  /** Element containing the rendered <svg> or <canvas>. */
  get element(): HTMLDivElement | null {
    return this.active?.el ?? null
  }

  /** Root <svg> element when using the SVG renderer. */
  get svg(): SVGSVGElement | null {
    return (this.active?.el.querySelector(':scope > svg') as SVGSVGElement | null) ?? null
  }

  get isReady(): boolean {
    return this.active !== null
  }

  setOptions(patch: Partial<LottiePlayerOptions>): void {
    this.opts = { ...this.opts, ...patch }
  }

  /** Loads (or reloads) a document, keeping the current frame. */
  load(doc: Animation): void {
    if (this.destroyed) return
    const token = ++this.token
    this.cancelPending()

    const el = document.createElement('div')
    el.className = 'le-player'
    el.style.cssText = 'position:absolute;inset:0;visibility:hidden;'
    this.host.appendChild(el)

    let anim: AnimationItem
    try {
      const data = prepareAnimationData(doc, {
        tagNodes: this.opts.tagNodes && this.opts.renderer === 'svg',
        solo: this.opts.solo,
      })
      anim = lottie.loadAnimation({
        container: el,
        renderer: this.opts.renderer as 'svg',
        loop: false,
        autoplay: false,
        animationData: data,
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          progressiveLoad: false,
          hideOnTransparent: true,
          // Not in lottie-web's typings, but supported by all renderers (5.13).
          runExpressions: this.opts.runExpressions ?? false,
        } as never,
      })
    } catch (err) {
      el.remove()
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)))
      return
    }

    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      scheduleFontProbeCleanup()
    }

    const show = () => {
      if (this.destroyed || this.pending?.token !== token) return
      this.pending.cleanup()
      this.pending = null
      settle()
      try {
        this.renderInto(anim, this.frame)
      } catch (err) {
        anim.destroy()
        el.remove()
        this.opts.onError?.(err instanceof Error ? err : new Error(String(err)))
        return
      }
      el.style.visibility = ''
      const old = this.active
      this.active = { anim, el }
      if (old) {
        old.anim.destroy()
        old.el.remove()
      }
      this.opts.onReady?.()
    }

    const onFail = () => {
      if (this.pending?.token !== token) return
      settle()
      this.cancelPending()
      this.opts.onError?.(new Error('lottie-web failed to load the animation'))
    }

    const offLoaded = anim.addEventListener('DOMLoaded', show)
    const offFailed = anim.addEventListener('data_failed', onFail)
    this.pending = {
      anim,
      el,
      token,
      cleanup: () => {
        offLoaded()
        offFailed()
        settle()
      },
    }
    // Without fonts to load, lottie-web is ready synchronously: swap in immediately.
    if (anim.isLoaded) show()
  }

  /** Renders an absolute frame of the root composition. */
  renderFrame(frame: number): void {
    this.frame = frame
    if (this.active) {
      try {
        this.renderInto(this.active.anim, frame)
      } catch (err) {
        this.opts.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  /** Notifies lottie-web that the container size changed (canvas renderer). */
  resize(): void {
    this.active?.anim.resize()
  }

  destroy(): void {
    this.destroyed = true
    this.cancelPending()
    if (this.active) {
      this.active.anim.destroy()
      this.active.el.remove()
      this.active = null
    }
  }

  private renderInto(anim: AnimationItem, frame: number): void {
    const relative = frame - anim.firstFrame
    const max = Math.max(0, anim.totalFrames - 0.001)
    anim.goToAndStop(Math.min(Math.max(0, relative), max), true)
  }

  private cancelPending(): void {
    if (!this.pending) return
    this.pending.cleanup()
    this.pending.anim.destroy()
    this.pending.el.remove()
    this.pending = null
  }
}
