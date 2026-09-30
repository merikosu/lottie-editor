/**
 * Creating, parsing, normalizing and serializing Lottie documents.
 */
import type { Animation } from './types'

export type LottieErrorCode = 'invalid-json' | 'not-lottie' | 'empty'

/** Error with a machine-readable code so the UI can show a translated message. */
export class LottieParseError extends Error {
  readonly code: LottieErrorCode
  constructor(code: LottieErrorCode, message: string) {
    super(message)
    this.name = 'LottieParseError'
    this.code = code
  }
}

export interface ParseResult {
  animation: Animation
  /** Non-fatal problems that were repaired while loading (English, for logs/tooltips). */
  repairs: string[]
}

export interface NewAnimationOptions {
  name?: string
  width?: number
  height?: number
  fps?: number
  /** Duration in frames */
  frames?: number
}

/** Creates an empty animation. */
export function createAnimation(opts: NewAnimationOptions = {}): Animation {
  const fr = opts.fps ?? 30
  return {
    v: '5.12.0',
    fr,
    ip: 0,
    op: opts.frames ?? fr * 3,
    w: opts.width ?? 512,
    h: opts.height ?? 512,
    nm: opts.name ?? 'Untitled',
    ddd: 0,
    assets: [],
    layers: [],
    markers: [],
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Quick structural check: does this object look like a Lottie animation? */
export function looksLikeLottie(value: unknown): value is Animation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return Array.isArray(o.layers) && (isNum(o.w) || isNum(o.h) || isNum(o.fr) || isNum(o.op))
}

/**
 * Repairs the fields the editor and players need to function (without touching anything
 * else). Returns a list of repairs. Mutates `anim`.
 */
export function normalizeAnimation(anim: Animation): string[] {
  const repairs: string[] = []
  if (!isNum(anim.fr) || anim.fr <= 0) {
    repairs.push(`Invalid frame rate "${String(anim.fr)}" replaced with 30.`)
    anim.fr = 30
  }
  if (!isNum(anim.ip)) {
    repairs.push('Missing in point (ip) set to 0.')
    anim.ip = 0
  }
  if (!isNum(anim.op) || anim.op <= anim.ip) {
    repairs.push('Invalid out point (op) repaired.')
    anim.op = anim.ip + Math.max(1, Math.round(anim.fr))
  }
  if (!isNum(anim.w) || anim.w <= 0) {
    repairs.push('Invalid width replaced with 512.')
    anim.w = 512
  }
  if (!isNum(anim.h) || anim.h <= 0) {
    repairs.push('Invalid height replaced with 512.')
    anim.h = 512
  }
  if (!Array.isArray(anim.layers)) {
    repairs.push('Missing layers array created.')
    anim.layers = []
  }
  if (anim.assets !== undefined && !Array.isArray(anim.assets)) {
    repairs.push('Invalid assets list replaced with an empty list.')
    anim.assets = []
  }
  return repairs
}

/** Parses Lottie JSON text. Throws LottieParseError with a code on failure. */
export function parseLottie(text: string): ParseResult {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) throw new LottieParseError('empty', 'The file is empty.')
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch (e) {
    throw new LottieParseError('invalid-json', e instanceof Error ? e.message : 'Invalid JSON')
  }
  return fromObject(data)
}

/** Validates an already-parsed object as a Lottie animation. */
export function fromObject(data: unknown): ParseResult {
  if (!looksLikeLottie(data)) {
    throw new LottieParseError('not-lottie', 'This JSON is not a Lottie animation (no layers).')
  }
  const animation = data as Animation
  const repairs = normalizeAnimation(animation)
  return { animation, repairs }
}

export interface SerializeOptions {
  /** Indent with 2 spaces. */
  pretty?: boolean
}

export function serializeLottie(anim: Animation, opts: SerializeOptions = {}): string {
  return JSON.stringify(anim, null, opts.pretty ? 2 : undefined)
}

/** Byte size of the minified JSON (UTF-8). */
export function jsonByteSize(anim: Animation): number {
  return new TextEncoder().encode(JSON.stringify(anim)).length
}
