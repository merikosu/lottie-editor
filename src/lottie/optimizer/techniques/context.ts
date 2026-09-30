/**
 * What every technique receives: the working copy (mutated in place), the document facts
 * gathered before the pipeline started, the resolved options and a warning sink.
 */
import type { DocContext, Json } from '../model'
import type { ImageReport, OptimizeOptions, OptimizeWarningCode } from '../types'

export interface TechniqueContext {
  /** The working copy (a JSON clone of the input), mutated in place. */
  doc: Json
  /** Facts about the ORIGINAL document (expressions, version, …): conservative for later steps. */
  info: DocContext
  options: OptimizeOptions
  warn(code: OptimizeWarningCode, count?: number, detail?: string): void
  /** Per-image results (filled by the image technique). */
  images: ImageReport[]
  /**
   * Share (0..1) of each property's error budget already spent by earlier steps (keyed by the
   * property object): keyframe simplification and path simplification record what they used,
   * precision rounds with the rest. Properties absent have their whole budget left.
   */
  spent: WeakMap<object, number>
  signal?: AbortSignal
}

/** What a technique changed, by kind (layers, shapes, keyframes, numbers, fields, …). */
export type TechniqueDetails = Record<string, number>

export type TechniqueFn = (tc: TechniqueContext) => TechniqueDetails | Promise<TechniqueDetails>

/** Throws the standard AbortError when the signal is aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The optimization was cancelled.', 'AbortError')
}
