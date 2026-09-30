/**
 * Messages between the optimizer client (main thread) and its Web Worker. Documents travel as
 * JSON strings (one copy, no structured-clone walk of a huge object graph).
 */
import type { VerifySemanticOptions } from './semantic'
import type {
  Analysis,
  OptimizeOptionsInput,
  OptimizeReport,
  SemanticReport,
  TechniqueId,
} from './types'

export type WorkerRequest =
  | {
      type: 'optimize'
      id: number
      json: string
      options?: OptimizeOptionsInput
      source?: string
      measureGzip?: boolean
    }
  | { type: 'analyze'; id: number; json: string; options?: OptimizeOptionsInput }
  | { type: 'verifySemantic'; id: number; a: string; b: string; options?: VerifySemanticOptions }

export type WorkerResponse =
  | { type: 'progress'; id: number; step: TechniqueId | 'measure'; done: number; total: number }
  | { type: 'optimized'; id: number; json: string; report: OptimizeReport }
  | { type: 'analysis'; id: number; analysis: Analysis }
  | { type: 'semantic'; id: number; report: SemanticReport }
  | { type: 'error'; id: number; name: string; message: string }
