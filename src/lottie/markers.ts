/**
 * Composition markers (`anim.markers`): named points or ranges on the root timeline.
 *
 * lottie-web reads the comment `cm` as JSON (`{"name": "intro"}`), then as "key: value"
 * lines (After Effects marker comments), and otherwise uses it verbatim as the name
 * (markerParser). `goToAndPlay(name)` plays [tm, tm + dr]. Renaming keeps whichever of these
 * forms the file already uses, so players and tooling that read the payload keep working.
 *
 * The mutating helpers are meant for immer recipes (`updateDoc(label, draft => …)`).
 */
import type { Animation, Marker } from './types'

/** Markers of an animation (empty when the file has none). */
export function getMarkers(anim: Pick<Animation, 'markers'>): Marker[] {
  return Array.isArray(anim.markers) ? anim.markers : []
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

function parseJsonPayload(cm: string): Record<string, unknown> | null {
  const text = cm.trim()
  if (!text.startsWith('{')) return null
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** "key: value" lines as written by After Effects; null when the comment is not in that form. */
function parseLinePayload(cm: string): Map<string, string> | null {
  const lines = cm.split('\r\n')
  const keys = new Map<string, string>()
  for (const line of lines) {
    const parts = line.split(':')
    // Same rule as lottie-web: only lines with exactly one colon count.
    if (parts.length === 2) keys.set(parts[0], parts[1].trim())
  }
  return keys.size > 0 ? keys : null
}

/** Display name of a marker: the payload `name` when the comment is structured. */
export function markerName(marker: Pick<Marker, 'cm'>): string {
  const cm = typeof marker.cm === 'string' ? marker.cm : ''
  const json = parseJsonPayload(cm)
  if (json) return typeof json.name === 'string' ? json.name : cm
  const lines = parseLinePayload(cm)
  if (lines?.has('name')) return lines.get('name') ?? ''
  return cm
}

/** Returns the comment with its name replaced, keeping the payload format of `cm`. */
export function withMarkerName(cm: string | undefined, name: string): string {
  const current = typeof cm === 'string' ? cm : ''
  const json = parseJsonPayload(current)
  if (json && typeof json.name === 'string') return JSON.stringify({ ...json, name })
  const lines = parseLinePayload(current)
  if (lines?.has('name')) {
    return current
      .split('\r\n')
      .map((line) => {
        const parts = line.split(':')
        return parts.length === 2 && parts[0] === 'name' ? `name: ${name}` : line
      })
      .join('\r\n')
  }
  return name
}

/** Duration of a marker in frames (never negative; missing means a point marker). */
export function markerDuration(marker: Pick<Marker, 'dr'>): number {
  return typeof marker.dr === 'number' && Number.isFinite(marker.dr) ? Math.max(0, marker.dr) : 0
}

/** End frame of a marker's range (equals `tm` for point markers). */
export function markerEnd(marker: Pick<Marker, 'tm' | 'dr'>): number {
  return marker.tm + markerDuration(marker)
}

/** "<prefix> N" with the smallest N ≥ markers.length + 1 that no marker uses yet. */
export function nextMarkerName(markers: readonly Pick<Marker, 'cm'>[], prefix: string): string {
  const used = new Set(markers.map((m) => markerName(m)))
  let n = markers.length + 1
  while (used.has(`${prefix} ${n}`)) n++
  return `${prefix} ${n}`
}

/** Index at which a marker at `tm` keeps the list ordered (after markers at the same time). */
function sortedIndex(markers: readonly Marker[], tm: number): number {
  let index = markers.length
  while (index > 0 && markers[index - 1].tm > tm) index--
  return index
}

export interface NewMarker {
  tm: number
  cm?: string
  dr?: number
}

/** Adds a marker (creating `markers` if needed), keeping markers ordered by time. Returns its index. */
export function addMarker(anim: Animation, marker: NewMarker): number {
  if (!Array.isArray(anim.markers)) anim.markers = []
  const entry: Marker = {
    tm: round3(marker.tm),
    cm: marker.cm ?? '',
    dr: round3(Math.max(0, marker.dr ?? 0)),
  }
  const index = sortedIndex(anim.markers, entry.tm)
  anim.markers.splice(index, 0, entry)
  return index
}

/** Removes markers by index (out-of-range indices are ignored). */
export function removeMarkers(anim: Animation, indices: readonly number[]): void {
  if (!Array.isArray(anim.markers)) return
  const remove = new Set(indices)
  anim.markers = anim.markers.filter((_, i) => !remove.has(i))
}

/**
 * Moves a marker to frame `tm` and re-inserts it in time order among the others.
 * Returns the marker's new index (or -1 when it does not exist).
 */
export function moveMarker(anim: Animation, index: number, tm: number): number {
  const markers = anim.markers
  const marker = markers?.[index]
  if (!markers || !marker) return -1
  markers.splice(index, 1)
  marker.tm = round3(tm)
  const next = sortedIndex(markers, marker.tm)
  markers.splice(next, 0, marker)
  return next
}

/** Sets a marker's duration in frames (clamped to ≥ 0). */
export function setMarkerDuration(anim: Animation, index: number, dr: number): void {
  const marker = anim.markers?.[index]
  if (!marker) return
  marker.dr = round3(Math.max(0, dr))
}

/** Renames a marker, keeping the comment's payload format. */
export function renameMarker(anim: Animation, index: number, name: string): void {
  const marker = anim.markers?.[index]
  if (!marker) return
  marker.cm = withMarkerName(marker.cm, name)
}

/** Index of the marker closest to `frame` within `tolerance` frames, or -1. */
export function markerAt(markers: readonly Marker[], frame: number, tolerance = 0.5): number {
  let best = -1
  let bestDist = Infinity
  markers.forEach((m, i) => {
    const d = Math.abs(m.tm - frame)
    if (d <= tolerance && d < bestDist) {
      best = i
      bestDist = d
    }
  })
  return best
}

/** Index of the first marker strictly after `frame` (by time), or -1. */
export function nextMarkerIndex(markers: readonly Marker[], frame: number, epsilon = 1e-3): number {
  let best = -1
  markers.forEach((m, i) => {
    if (m.tm > frame + epsilon && (best < 0 || m.tm < markers[best].tm)) best = i
  })
  return best
}

/** Index of the last marker strictly before `frame` (by time), or -1. */
export function prevMarkerIndex(markers: readonly Marker[], frame: number, epsilon = 1e-3): number {
  let best = -1
  markers.forEach((m, i) => {
    if (m.tm < frame - epsilon && (best < 0 || m.tm > markers[best].tm)) best = i
  })
  return best
}
