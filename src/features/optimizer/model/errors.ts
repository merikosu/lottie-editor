/**
 * Translated failure messages for the queue: files that cannot be read use the editor's open
 * messages (same wording everywhere); anything else says the optimizer failed and why.
 */
import { describeOpenError } from '@/features/io'
import { getT } from '@/i18n'
import { DotLottieError } from '@/lottie/dotlottie'
import { LottieFileError } from '@/lottie/formats'
import type { JobError } from './types'

export function describeFailure(error: unknown, fileName: string): JobError {
  const t = getT()
  if (error instanceof LottieFileError || error instanceof DotLottieError) {
    const message = describeOpenError(error, fileName, t)
    return { title: message.title, lines: message.lines }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return { title: t.optimizer.errors.failed, lines: detail ? [detail] : [] }
}
