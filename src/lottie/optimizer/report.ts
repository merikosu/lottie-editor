/**
 * Report helpers: totals and the delivery format recommendation.
 *
 * Compression is transport, not optimization: a JSON served by a web server travels gzipped,
 * a .lottie is a zip, a .tgs is gzip. The recommendation compares what actually travels for the
 * user's goal.
 */
import type { Animation } from '../types'
import { issuesForTarget, validate } from '../validate'
import type { DeliveryGoal, FormatRecommendation, OptimizeReport, SizeReport } from './types'

export interface Savings {
  raw: number
  gzip: number
  dotLottie: number
  /** Fractions saved (0..1). */
  rawShare: number
  gzipShare: number
  dotLottieShare: number
}

const share = (a: number, b: number) => (a > 0 ? (a - b) / a : 0)

/** Bytes (and shares) saved between `before` and `after`. */
export function totalSaved(report: Pick<OptimizeReport, 'before' | 'after'>): Savings {
  const { before, after } = report
  return {
    raw: before.raw - after.raw,
    gzip: before.gzip - after.gzip,
    dotLottie: before.dotLottie - after.dotLottie,
    rawShare: share(before.raw, after.raw),
    gzipShare: share(before.gzip, after.gzip),
    dotLottieShare: share(before.dotLottie, after.dotLottie),
  }
}

/** Telegram accepts the animation as a sticker (size, fps, duration, features, 64 KB gzip). */
export function telegramCompatible(anim: Animation, size: SizeReport): boolean {
  const issues = issuesForTarget(
    validate(anim, { rawBytes: size.raw, gzipBytes: size.gzip }),
    'telegram',
  )
  return !issues.some((i) => i.severity === 'error')
}

/**
 * The format to ship for a goal: web → gzip-served JSON unless the .lottie is smaller (it is
 * with embedded images, which it stores as binary files instead of base64); mobile → .lottie
 * (native players read it, and apps bundle files without HTTP compression); telegram → .tgs
 * when the sticker rules are met.
 */
export function recommendFormat(
  anim: Animation,
  size: SizeReport,
  goal: DeliveryGoal,
): FormatRecommendation {
  if (goal === 'telegram') {
    return telegramCompatible(anim, size)
      ? { goal, format: 'tgs', bytes: size.gzip, reason: 'telegram' }
      : { goal, format: 'tgs', bytes: size.gzip, reason: 'telegramIncompatible' }
  }
  const lottie = size.dotLottie > 0 ? size.dotLottie : Infinity
  if (goal === 'mobile') {
    return lottie <= size.raw
      ? { goal, format: 'lottie', bytes: lottie, reason: 'mobileRuntime' }
      : { goal, format: 'json', bytes: size.raw, reason: 'gzipSmallest' }
  }
  if (lottie < size.gzip) {
    return {
      goal,
      format: 'lottie',
      bytes: lottie,
      reason: size.counts.images > 0 ? 'imagesPackaged' : 'dotLottieSmallest',
    }
  }
  return { goal, format: 'json', bytes: size.gzip, reason: 'gzipSmallest' }
}
