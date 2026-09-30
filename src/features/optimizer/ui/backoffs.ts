/**
 * Words for the settings the guarantee relaxed (see `nextBackoff`).
 */
import type { Dict } from '@/i18n'
import type { Backoff } from '@/lottie/optimizer'
import type { Format } from './format'

/**
 * What was relaxed, compactly: repeated steps of one kind collapse into one ("tolerance 0.2 px →
 * 0.05 px"), turned-off techniques are listed together.
 */
export function describeBackoffs(backoffs: Backoff[], t: Dict, f: Format): string {
  const B = t.optimizer.result.backoff
  const out: string[] = []
  const span = (kind: Backoff['kind']) => {
    const steps = backoffs.filter((b) => b.kind === kind)
    return steps.length ? { from: steps[0].from ?? 0, to: steps[steps.length - 1].to ?? 0 } : null
  }
  const quality = span('imageQuality')
  if (quality) out.push(B.imageQuality(f.percent(quality.from), f.percent(quality.to)))
  const tolerance = span('tolerance')
  if (tolerance) out.push(B.tolerance(f.px(tolerance.from), f.px(tolerance.to)))
  const off = backoffs
    .filter((b) => b.kind === 'disable' && b.technique)
    .map((b) => t.optimizer.techniques[b.technique!].name)
  if (off.length) out.push(B.disable(off.join(', ')))
  return out.join('; ')
}
