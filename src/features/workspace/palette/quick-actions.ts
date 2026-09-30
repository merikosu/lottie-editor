/**
 * Queries that are values rather than words:
 *  - "42", "f42", "42f", "кадр 42" → go to frame 42
 *  - "2s", "1.5 sec", "2,5 с", "0:02.5" → go to that time (converted to a frame)
 *  - "1.5x", "×2", "speed 75%", "скорость 0,5" → set the preview speed
 */
import { roundTo } from '@/lib/math'
import { lastFrame } from '@/lottie/time'

export interface FrameAction {
  kind: 'frame'
  /** Target frame (integer). */
  frame: number
  /** Seconds, when the query was a time. */
  seconds?: number
  inRange: boolean
  first: number
  last: number
}

export interface SpeedAction {
  kind: 'speed'
  speed: number
}

export type QuickAction = FrameAction | SpeedAction

export interface TimeInfo {
  ip: number
  op: number
  fr: number
}

/** Preview speed limits of the playback store. */
export const MIN_SPEED = 0.05
export const MAX_SPEED = 16

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const FRAME = new RegExp(
  String.raw`^(?:#|f|fr|frame|к|кадр)?\s*(\d+)\s*(?:f|fr|frames?|к|кадр(?:а|ов)?)?$`,
  'i',
)
const SECONDS = new RegExp(String.raw`^${NUM}\s*(?:s|sec|secs|seconds?|с|сек|секунд[аы]?)$`, 'i')
const TIMECODE = new RegExp(String.raw`^(\d+):${NUM}$`)
const SPEED_WORD = new RegExp(String.raw`^(?:speed|скорость)\s*[:=]?\s*${NUM}\s*(x|×|%)?$`, 'i')
const SPEED_SUFFIX = new RegExp(String.raw`^${NUM}\s*(x|×)$`, 'i')
const SPEED_PREFIX = new RegExp(String.raw`^(?:x|×)\s*${NUM}$`, 'i')

const num = (s: string) => Number(s.replace(',', '.'))

/** 1.5 → "1.5×". */
export function formatSpeed(speed: number): string {
  return `${roundTo(speed, 2)}×`
}

function frameAction(frame: number, doc: TimeInfo, seconds?: number): FrameAction {
  const first = Math.ceil(doc.ip)
  const last = lastFrame(doc)
  return { kind: 'frame', frame, seconds, inRange: frame >= first && frame <= last, first, last }
}

function parseSpeed(q: string): number | null {
  let m = SPEED_WORD.exec(q)
  if (m) {
    const value = num(m[1])
    const unit = m[2]
    // "speed 75" means 75%; "speed 2" means 2× (preview speeds top out at a few ×).
    if (unit === '%' || (!unit && value > 4)) return value / 100
    return value
  }
  m = SPEED_SUFFIX.exec(q) ?? SPEED_PREFIX.exec(q)
  return m ? num(m[1]) : null
}

/** Actions for a query; `doc` is null when no animation is open (then there are none). */
export function parseQuickActions(query: string, doc: TimeInfo | null): QuickAction[] {
  const q = query.trim()
  if (!q || !doc) return []
  const fps = doc.fr > 0 ? doc.fr : 30

  let m = FRAME.exec(q)
  if (m) return [frameAction(Number(m[1]), doc)]

  m = SECONDS.exec(q)
  if (m) {
    const seconds = num(m[1])
    return [frameAction(Math.round(seconds * fps), doc, seconds)]
  }

  m = TIMECODE.exec(q)
  if (m) {
    const seconds = Number(m[1]) * 60 + num(m[2])
    return [frameAction(Math.round(seconds * fps), doc, seconds)]
  }

  const speed = parseSpeed(q)
  if (speed !== null && Number.isFinite(speed) && speed >= MIN_SPEED && speed <= MAX_SPEED) {
    return [{ kind: 'speed', speed }]
  }
  return []
}
