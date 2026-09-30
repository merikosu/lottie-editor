/**
 * One pass over a document for the insights UI: its serialized size (raw and gzip), the
 * validation issues and the statistics. Runs in a worker (`analysis.worker.ts`), or inline when
 * workers are unavailable. Each part is computed on its own, so a checker bug on an unusual file
 * still leaves the size readout working.
 */
import { computeStats, measureJson, type DocumentStatistics, type SizeInfo } from '@/lottie/stats'
import type { Animation } from '@/lottie/types'
import { validate, type Issue } from '@/lottie/validate'

export interface AnalysisResult {
  /** Null only when the whole analysis failed. */
  size: SizeInfo | null
  /** Null when validation failed (see `error`). */
  issues: Issue[] | null
  /** Null when the statistics failed (see `error`). */
  stats: DocumentStatistics | null
  /** First failure message, if any part failed. */
  error: string | null
  /** Time spent, in milliseconds. */
  ms: number
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Analyzes a document; `json` must be its minified serialization (`JSON.stringify(anim)`). */
export function analyze(anim: Animation, json: string): AnalysisResult {
  const start = now()
  const size = measureJson(json, anim)
  let error: string | null = null
  let issues: Issue[] | null = null
  let stats: DocumentStatistics | null = null
  try {
    issues = validate(anim, { rawBytes: size.raw, gzipBytes: size.gzip })
  } catch (err) {
    error = message(err)
  }
  try {
    stats = computeStats(anim)
  } catch (err) {
    error ??= message(err)
  }
  return { size, issues, stats, error, ms: now() - start }
}

/** Parses and analyzes serialized JSON (the worker's entry point). */
export function analyzeJson(json: string): AnalysisResult {
  return analyze(JSON.parse(json) as Animation, json)
}

/* ------------------------------ Worker protocol ----------------------------- */

export type AnalysisRequest = { type: 'ping' } | { type: 'analyze'; id: number; json: string }

export type AnalysisResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; result: AnalysisResult }
  | { type: 'error'; id: number; message: string }
