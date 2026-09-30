/**
 * Lottie optimizer engine (public API).
 *
 *   const { animation, json, report } = await optimizeAnimation(anim, 'balanced')
 *
 * - `optimizeAnimation(anim, options, hooks)` — ordered pipeline of techniques, sizes measured
 *   after each step (raw, gzip) so the report can show every technique's contribution.
 * - `PRESETS` / `resolveOptions` — safe (lossless), balanced (default, visually lossless),
 *   maximum.
 * - `measure(anim)` — raw / gzip / dotLottie sizes and content counts.
 * - `analyze(anim, options)` — quick dry run: what each technique would change.
 * - `verifySemantic(a, b)` — scene-level equivalence check (Node and workers).
 * - `verifyVisual(a, b)` / `autoSafe(anim, options)` — browser-only pixel verification.
 * - `createOptimizerClient()` (./client) — runs the pipeline in a Web Worker.
 */
export * from './types'
export {
  PRESETS,
  PRESET_IDS,
  DEFAULT_PRESET,
  TECHNIQUES,
  TECHNIQUE_IDS,
  resolveOptions,
  matchPreset,
  techniqueCategory,
} from './presets'
export { optimizeAnimation } from './pipeline'
export { analyze } from './analyze'
export { measure, countContent, gzipBytes, dotLottieBytes } from './measure'
export { recommendFormat, totalSaved, telegramCompatible, type Savings } from './report'
export {
  verifySemantic,
  buildScene,
  describeMismatches,
  DEFAULT_SEMANTIC_TOLERANCE,
  type VerifySemanticOptions,
} from './semantic'
export {
  verifyVisual,
  autoSafe,
  nextBackoff,
  visualFrames,
  withSeededRandom,
  type AutoSafeOptions,
  type AutoSafeResult,
  type Backoff,
} from './visual'
export {
  createOptimizerClient,
  type OptimizerClient,
  type OptimizerClientOptions,
  type OptimizeJobOptions,
} from './client'
