/**
 * The optimizer queue's data model.
 *
 * A job is one dropped file (or the editor's document). It holds one part per animation: almost
 * always one, several for a dotLottie with many animations (they are optimized separately and
 * written back into the same container). Documents are kept as JSON text, not objects: a queue of
 * large files would otherwise hold several parsed copies of each; views parse what they show.
 */
import type {
  Backoff,
  OptimizeOptions,
  OptimizeReport,
  TechniqueId,
  VisualReport,
} from '@/lottie/optimizer'
import type { DotLottieContainer } from '@/lottie/dotlottie'
import type { Animation } from '@/lottie/types'
import type { VerifyFrames } from './settings'

/** What a job was made from; decides "same as input" and the format chip. */
export type InputFormat = 'json' | 'lottie' | 'tgs' | 'zip'

/** Formats a job can be written as. */
export type OutputFormat = 'json' | 'lottie' | 'tgs'

/** The queue-wide output choice. */
export type OutputChoice = 'same' | 'json' | 'lottie'

/** A translated error, built when it happens (the language rarely changes mid-job). */
export interface JobError {
  title: string
  lines: string[]
}

/** One optimization run of a part (the result is replaced by every re-run). */
export interface PartResult {
  /** Settings key of the requested options (see `optionsKey`). */
  key: string
  /** Options that produced `json` (the requested ones, relaxed by `backoffs`). */
  effective: OptimizeOptions
  /** Settings relaxed automatically because the visual check found a difference. */
  backoffs: Backoff[]
  json: string
  report: OptimizeReport
}

export type VerifyStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface VerifyState {
  status: VerifyStatus
  /** `PartResult.json` the check belongs to (a re-run makes it stale). */
  of?: string
  /** Frames setting the check ran with. */
  frames?: VerifyFrames
  visual?: VisualReport
  /** Why the check could not run (English, for the tooltip). */
  error?: string
}

/** One animation of a job. */
export interface JobPart {
  /** Animation id (dotLottie manifest id, else derived from the file name). */
  id: string
  name: string
  /** JSON text sent to the optimizer. */
  source: string
  /** The file text as delivered (whitespace included), for honest "before" sizes; JSON only. */
  delivered?: string
  info: PartInfo
  /** Latest completed optimization (kept on screen while a re-run is in flight). */
  result: PartResult | null
  /** Optimization in flight: its settings key and progress. */
  run: { key: string; progress: number; step: TechniqueId | 'measure' | null } | null
  verify: VerifyState
  /** Optimization failed for the settings with this key (not retried until they change). */
  error: (JobError & { key: string }) | null
}

/** Cheap facts about an animation, read once. */
export interface PartInfo {
  width: number
  height: number
  fps: number
  ip: number
  op: number
  images: number
}

export type JobOrigin =
  | { kind: 'file' }
  /** The editor's document: the result can replace it (one undo step). */
  | { kind: 'editor'; docId: string; doc: Animation; replaced: boolean }

export interface Job {
  id: string
  /** File name as dropped (or the editor document's name). */
  name: string
  input: InputFormat
  /** Bytes of the file as dropped (the minified JSON for the editor's document). */
  inputSize: number
  origin: JobOrigin
  /** The dropped file, until it has been read. */
  file: File | null
  /** Images dropped with it (a Bodymovin export folder). */
  images: File[]
  /** dotLottie container (themes, state machines, manifest) written back on output. */
  container: DotLottieContainer | null
  /** Empty until the file has been read. */
  parts: JobPart[]
  /** Part shown in the detail view. */
  active: number
  /** Settings for this file only; null follows the queue's settings. */
  options: OptimizeOptions | null
  phase: 'reading' | 'ready' | 'error'
  error: JobError | null
  /** Still frame of the first animation (data URL), once rendered. */
  thumbnail: string | null
  addedAt: number
}

/** Status shown for a job, derived from its parts. */
export type JobStatus = 'reading' | 'queued' | 'optimizing' | 'verifying' | 'done' | 'error'
