/**
 * Owns one LottiePlayer for a viewport pane: coalesced (re)loads, error reporting and
 * recovery.
 *
 * - Edits stream in during drags: loads are coalesced to one per animation frame and at most
 *   one per `max(50 ms, 2 × last load time)`, always with a trailing load of the latest
 *   document, so big files cannot monopolize the main thread. When a load is slow (a big file)
 *   and the edits come from a gesture in progress, the load waits for the gesture to end (up to
 *   a maximum wait) instead of freezing the drag every other frame.
 * - Edits that cannot change the picture (renames, markers) keep the current player: on big
 *   files a reload costs hundreds of milliseconds (see lib/render-diff.ts).
 * - lottie-web reports build/render failures without throwing (see lottie-errors.ts), and a
 *   failed build may still be swapped in by the player. When a new instance fails, the last
 *   good document is reloaded right away (before the next paint for synchronous loads), so
 *   the canvas keeps showing the last good frame while the error banner explains why.
 */
import type { AnimationItem } from 'lottie-web'
import type { NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { LottiePlayer } from '@/player/LottiePlayer'
import type { RendererType } from '@/store/prefs'
import { rendersSame } from './lib/render-diff'
import { routeLottieErrors } from './lottie-errors'

const MIN_RELOAD_INTERVAL = 50
/** Loads slower than this noticeably block input: during gestures they wait for a pause. */
const HEAVY_LOAD_MS = 90

export interface PlayerBindingOptions {
  host: HTMLElement
  renderer: RendererType
  runExpressions: boolean
  /** Tag layers/groups for hit-testing (only meaningful with the SVG renderer). */
  interactive: boolean
  /** Preview-only solo: layers to keep visible (see prepareAnimationData). */
  solo?: NodePath[]
  /**
   * Maps the editor's document to the one shown (the edited pane previews a theme). Must return
   * the same object while its inputs do not change, so repeated requests do not reload.
   */
  present?: (doc: Animation) => Animation
  /**
   * A load was swapped in and rendered. `clean` is false when the current document failed
   * (the display shows the restored last good document, or nothing better was available).
   */
  onReady: (clean: boolean) => void
  /** `load` identifies the load attempt: its first error is the root cause worth showing. */
  onError: (error: Error, load: number) => void
}

export class PlayerBinding {
  readonly player: LottiePlayer
  private readonly opts: PlayerBindingOptions
  private readonly unroute: () => void
  /** Document requested by the editor (the one that should be displayed). */
  private loaded: Animation | null = null
  /** Last document that loaded and rendered without errors. */
  private good: Animation | null = null
  /** Sequence number of the latest `player.load` call (each load cancels the previous one). */
  private seq = 0
  /** Load whose instance reported an error. */
  private failedSeq = -1
  /** Load that restores the last good document after a failure. */
  private recoverySeq = -1
  private queued: Animation | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private raf = 0
  private lastLoadAt = -Infinity
  private loadCost = 0
  /** When a gesture started deferring a heavy load (null: nothing deferred). */
  private burstStart: number | null = null
  private runExpressions: boolean
  private destroyed = false

  constructor(opts: PlayerBindingOptions) {
    this.opts = opts
    this.runExpressions = opts.runExpressions
    this.player = new LottiePlayer(opts.host, {
      renderer: opts.renderer,
      runExpressions: opts.runExpressions,
      tagNodes: opts.interactive && opts.renderer === 'svg',
      solo: opts.solo,
      onError: (err) => this.fail(err, null),
      onReady: () => this.ready(),
    })
    this.unroute = routeLottieErrors(opts.host, (anim, err) => this.fail(err, anim))
  }

  get renderer(): RendererType {
    return this.player.renderer
  }

  /**
   * Requests a load of `doc`; bursts are coalesced unless `immediate`. `minInterval` lowers the
   * minimum time between loads for direct manipulation on the canvas (never below 2 × load time).
   * `continuous`: the edit is a step of a gesture in progress (drag, scrub).
   */
  request(
    source: Animation | null,
    immediate = false,
    minInterval = MIN_RELOAD_INTERVAL,
    continuous = false,
  ): void {
    if (!source || this.destroyed) return
    const doc = this.present(source)
    if (doc === this.loaded && !this.queued) return
    if (!immediate && this.loaded && rendersSame(this.loaded, doc, this.runExpressions)) {
      // The player already shows this picture (a rename, a marker, a drag that came back to
      // where it started, a cancelled drag): drop what was waiting to load.
      this.queued = null
      this.burstStart = null
      this.cancelScheduled()
      return
    }
    // Same picture as the load already waiting: keep that one. Expressions may read names.
    const same = !immediate && !!this.queued && rendersSame(this.queued, doc, this.runExpressions)
    if (!same) this.queued = doc
    if (immediate) {
      this.flush()
      return
    }
    if (continuous && this.loadCost >= HEAVY_LOAD_MS) {
      this.deferDuringGesture()
      return
    }
    // A discrete edit (or a gesture's last step): a load the gesture deferred is due now.
    if (this.burstStart !== null) {
      this.burstStart = null
      this.cancelScheduled()
    }
    if (this.timer !== null || this.raf !== 0) return
    const interval = Math.max(minInterval, this.loadCost * 2)
    const wait = this.lastLoadAt + interval - performance.now()
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, wait)
    } else {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0
        this.flush()
      })
    }
  }

  /**
   * Heavy file, gesture in progress: a load would freeze the drag for its whole duration, so it
   * waits for the gesture to end (`endGesture`), or at most `maxWait` so long drags still show
   * progress now and then.
   */
  private deferDuringGesture(): void {
    if (this.burstStart !== null) return
    this.burstStart = performance.now()
    this.cancelScheduled()
    this.timer = setTimeout(
      () => {
        this.timer = null
        this.flush()
      },
      Math.max(1200, this.loadCost * 4),
    )
  }

  /**
   * Shows `doc` again after a cancelled preview (Esc during a drag): at once when the player
   * shows something else, not at all when it never left it (a big file deferred the previews).
   */
  restore(source: Animation | null): void {
    if (!source || this.destroyed) return
    if (this.loaded && rendersSame(this.loaded, this.present(source), this.runExpressions)) {
      this.queued = null
      this.burstStart = null
      this.cancelScheduled()
      return
    }
    this.request(source, true)
  }

  private present(doc: Animation): Animation {
    return this.opts.present ? this.opts.present(doc) : doc
  }

  /** The pointer was released: a load deferred while the gesture ran is due now. */
  endGesture(): void {
    if (this.burstStart === null || this.destroyed) return
    this.burstStart = null
    this.cancelScheduled()
    if (!this.queued) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.flush()
    })
  }

  /** A different document is about to load: never restore the previous one on failure. */
  forgetLastGood(): void {
    this.good = null
  }

  /** Reloads the current document now (Try again, renderer or expression changes). */
  reload(): void {
    const doc = this.queued ?? this.loaded
    if (!doc || this.destroyed) return
    this.queued = doc
    this.flush()
  }

  /**
   * Changes renderer, expression evaluation or solo and reloads (double-buffered, no flash).
   * With `reload: false` the caller reloads later (e.g. after sizing the host for a new renderer).
   */
  configure(
    patch: { renderer?: RendererType; runExpressions?: boolean; solo?: NodePath[] },
    reload = true,
  ): void {
    const renderer = patch.renderer ?? this.player.renderer
    if (patch.runExpressions !== undefined) this.runExpressions = patch.runExpressions
    this.player.setOptions({ ...patch, tagNodes: this.opts.interactive && renderer === 'svg' })
    if (reload) this.reload()
  }

  renderFrame(frame: number): void {
    this.player.renderFrame(frame)
  }

  destroy(): void {
    this.destroyed = true
    this.cancelScheduled()
    this.unroute()
    this.player.destroy()
  }

  private cancelScheduled(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.timer = null
    this.raf = 0
  }

  private flush(): void {
    this.cancelScheduled()
    this.burstStart = null
    const doc = this.queued
    this.queued = null
    if (!doc || this.destroyed) return
    this.loaded = doc
    const start = performance.now()
    this.load(doc, false)
    this.lastLoadAt = performance.now()
    this.loadCost = this.lastLoadAt - start
  }

  private load(doc: Animation, recovery: boolean): void {
    this.seq++
    this.recoverySeq = recovery ? this.seq : -1
    this.player.load(doc)
  }

  private ready(): void {
    if (this.destroyed) return
    const seq = this.seq
    if (seq === this.recoverySeq || seq === this.failedSeq) {
      this.opts.onReady(false)
      return
    }
    this.good = this.loaded
    this.opts.onReady(true)
  }

  /**
   * `anim` is the lottie instance that failed; null when the load threw before an instance
   * existed (the previous instance then simply stays on screen).
   */
  private fail(error: Error, anim: AnimationItem | null): void {
    if (this.destroyed) return
    this.opts.onError(error, this.seq)
    // Failures of the instance on screen happen while rendering frames: nothing to restore.
    if (anim !== null && anim === this.player.animation) return
    if (this.failedSeq === this.seq) return
    this.failedSeq = this.seq
    const good = this.good
    if (anim === null || this.seq === this.recoverySeq || !good || good === this.loaded) return
    const seq = this.seq
    // Outside lottie's call stack; before the next paint (and before its DOMLoaded timer).
    queueMicrotask(() => {
      if (!this.destroyed && this.seq === seq) this.load(good, true)
    })
  }
}
