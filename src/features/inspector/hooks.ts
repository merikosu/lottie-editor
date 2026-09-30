/**
 * Hooks shared by the inspector sections.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { compAssetIndexOf, getAt, layerPathOf, pathKey, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { useDocument } from '@/store/document'
import { usePlayback } from '@/store/playback'
import { fontStack, isGenericFamily } from '@/lottie/text'
import { compTimeFor, type CompTime } from './model/time'

/* -------------------------------------------------------------------------- */
/*                           Throttled playhead frame                         */
/* -------------------------------------------------------------------------- */

/** While playing, the inspector updates its numbers at most this often (ms). */
const PLAYBACK_INTERVAL = 100

const floorFrame = (f: number) => Math.floor(f + 1e-6)

let current = 0
let lastEmit = 0
let timer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null
const listeners = new Set<() => void>()

function emit(frame: number) {
  if (timer) clearTimeout(timer)
  timer = null
  if (frame === current) return
  current = frame
  lastEmit = performance.now()
  listeners.forEach((l) => l())
}

function start() {
  current = floorFrame(usePlayback.getState().frame)
  unsubscribe = usePlayback.subscribe(
    (s) => s.frame,
    (frame) => {
      const f = floorFrame(frame)
      if (!usePlayback.getState().playing) {
        emit(f)
        return
      }
      const wait = PLAYBACK_INTERVAL - (performance.now() - lastEmit)
      if (wait <= 0) emit(f)
      else timer ??= setTimeout(() => emit(floorFrame(usePlayback.getState().frame)), wait)
    },
  )
}

function subscribeFrame(listener: () => void): () => void {
  if (listeners.size === 0) start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      unsubscribe?.()
      unsubscribe = null
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

const frameSnapshot = () => (unsubscribe ? current : floorFrame(usePlayback.getState().frame))

/**
 * Integer playhead frame (root composition). Updates immediately when paused and at most
 * ~10×/s during playback, so the inspector never re-renders at 60 fps.
 */
export function useInspectorFrame(): number {
  return useSyncExternalStore(subscribeFrame, frameSnapshot, frameSnapshot)
}

/* -------------------------------------------------------------------------- */
/*                                Document reads                              */
/* -------------------------------------------------------------------------- */

/** Values at several paths; re-renders only when one of them changes (structural sharing). */
export function useNodesAt<T>(paths: readonly NodePath[]): (T | undefined)[] {
  return useDocument(useShallow((s) => paths.map((p) => (s.doc ? getAt<T>(s.doc, p) : undefined))))
}

/** Serializes what a composition time mapping depends on, so hooks only update when it changes. */
function timeSignature(doc: Animation, path: NodePath, frame: number): string {
  const t = compTimeFor(doc, path, frame)
  if (t.assetIndex === null) return `r${frame}`
  const chain = t.chain
    .map((p) => {
      const l = getAt<{ st?: number; sr?: number; ip: number; op: number; tm?: unknown }>(doc, p)
      return l ? `${pathKey(p)}:${l.st}:${l.sr}:${l.ip}:${l.op}:${l.tm ? 1 : 0}` : ''
    })
    .join(',')
  return `${t.frame}|${t.instances}|${t.orphan}|${t.remapped}|${chain}`
}

/**
 * Comp times keyed by composition + mapping signature: every node of a composition shares one
 * object, so equal mappings keep their identity. Keying by node would make a big selection
 * (hundreds of layers) overflow the cache within one render, and selectors would then return
 * new objects on every call (an update loop).
 */
const timeCache = new Map<string, CompTime>()
const TIME_CACHE_SIZE = 256

function cachedCompTime(doc: Animation | null, path: NodePath, frame: number): CompTime {
  const layerPath = layerPathOf(path)
  const assetIndex = layerPath ? compAssetIndexOf(layerPath) : null
  const key = doc ? `${assetIndex ?? 'root'}@${timeSignature(doc, path, frame)}` : `none${frame}`
  let hit = timeCache.get(key)
  if (!hit) {
    hit = doc ? compTimeFor(doc, path, frame) : rootCompTime(frame)
    timeCache.set(key, hit)
    if (timeCache.size > TIME_CACHE_SIZE) timeCache.delete(timeCache.keys().next().value as string)
  }
  return hit
}

function rootCompTime(frame: number): CompTime {
  return {
    frame,
    assetIndex: null,
    chain: [],
    instances: 0,
    orphan: false,
    remapped: false,
    toRoot: (t) => t,
    fromRoot: (f) => f,
  }
}

/**
 * Time context of each node (playhead in the node's composition time, root ⇄ local mapping).
 * Re-renders only when a mapping actually changes.
 */
export function useCompTimes(paths: readonly NodePath[]): CompTime[] {
  const frame = useInspectorFrame()
  return useDocument(useShallow((s) => paths.map((p) => cachedCompTime(s.doc, p, frame))))
}

/* -------------------------------------------------------------------------- */
/*                                   Layout                                   */
/* -------------------------------------------------------------------------- */

/** Tracks an element's content width (pass the returned setter as `ref`). */
export function useElementWidth<T extends Element>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width]
}

/* -------------------------------------------------------------------------- */
/*                               Font availability                            */
/* -------------------------------------------------------------------------- */

const fontCache = new Map<string, boolean>()

/**
 * Checks whether a font family renders with its own glyphs: text measured with the family
 * and a fallback must differ from the fallback alone (for at least one of two fallbacks).
 */
function measureFontAvailable(family: string): boolean {
  if (typeof document === 'undefined') return true
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return true
  const sample = 'mmmmmmmmmmlli1WQ@#Ёжщ'
  const quoted = `"${family.replace(/"/g, '')}"`
  return ['monospace', 'serif'].some((fallback) => {
    ctx.font = `72px ${fallback}`
    const base = ctx.measureText(sample).width
    ctx.font = `72px ${quoted}, ${fallback}`
    return Math.abs(ctx.measureText(sample).width - base) > 0.5
  })
}

/** Bumped whenever web fonts finish loading, so availability is measured again. */
function useFontsVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts) return
    const onDone = () => setVersion((v) => v + 1)
    fonts.addEventListener('loadingdone', onDone)
    return () => fonts.removeEventListener('loadingdone', onDone)
  }, [])
  return version
}

/**
 * True when the font (a family or a CSS stack) renders with an intended font: one of its
 * families is installed or loaded. Checked again when web fonts finish loading.
 */
export function useFontAvailable(family: string | undefined): boolean {
  const version = useFontsVersion()
  return useMemo(() => {
    // A stack of generic families only ("sans-serif") always renders as intended.
    const named = fontStack(family).filter((f) => !isGenericFamily(f))
    if (named.length === 0) return true
    return named.some((f) => {
      const cacheKey = `${version}:${f}`
      let available = fontCache.get(cacheKey)
      if (available === undefined) {
        available = measureFontAvailable(f)
        fontCache.set(cacheKey, available)
      }
      return available
    })
  }, [family, version])
}
