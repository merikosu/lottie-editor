/**
 * Routes lottie-web's internal errors to the viewport that owns the animation.
 *
 * lottie-web catches its own exceptions: build failures ("configError", fired synchronously
 * inside `loadAnimation`, before any listener can be attached) and render failures
 * ("renderFrameError") are reported through `this.onError` / the `error` event instead of
 * being thrown, so `LottiePlayer` never sees them. Every AnimationItem looks `onError` up on
 * the shared prototype (instances never define it), so one dispatcher installed there
 * receives all of them; it forwards each error to the listener whose DOM subtree contains
 * the animation's container. Animations of other features are unaffected.
 */
import lottie, { type AnimationItem } from 'lottie-web'

export type LottieErrorListener = (anim: AnimationItem, error: Error) => void

const routes = new Map<Element, LottieErrorListener>()
let installed = false

interface LottieErrorEvent {
  type?: string
  nativeError?: unknown
}

function toError(event: unknown): Error {
  const native = (event as LottieErrorEvent | null)?.nativeError
  if (native instanceof Error) return native
  if (typeof native === 'string' && native) return new Error(native)
  const type = (event as LottieErrorEvent | null)?.type
  return new Error(type ? `lottie-web ${type}` : 'lottie-web failed to render the animation')
}

function install(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  let probe: AnimationItem | null = null
  try {
    // The AnimationItem class is not exported: take the prototype from a throwaway instance.
    probe = lottie.loadAnimation({
      container: document.createElement('div'),
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: { v: '5.7.0', fr: 30, ip: 0, op: 1, w: 1, h: 1, layers: [] },
    })
    const proto = Object.getPrototypeOf(probe) as { onError?: unknown }
    const previous = proto.onError
    proto.onError = function dispatch(this: AnimationItem, event: unknown) {
      const container = (this as unknown as { wrapper?: Element | null }).wrapper
      if (container) {
        for (const [root, listener] of routes) {
          if (root.contains(container)) listener(this, toError(event))
        }
      }
      if (typeof previous === 'function') (previous as (e: unknown) => void).call(this, event)
    }
  } catch (err) {
    console.warn('Could not hook lottie-web error reporting', err)
  } finally {
    probe?.destroy()
  }
}

/** Reports lottie-web errors of animations rendered inside `root`. Returns an unsubscribe function. */
export function routeLottieErrors(root: Element, listener: LottieErrorListener): () => void {
  install()
  routes.set(root, listener)
  return () => {
    if (routes.get(root) === listener) routes.delete(root)
  }
}
