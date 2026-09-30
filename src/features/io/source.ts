/**
 * What `DocumentMeta.dotLottie` holds for documents opened by the io feature (it is opaque to
 * the rest of the app): a dotLottie container, or a marker for Telegram stickers so ⌘S writes a
 * `.tgs` again.
 */
import { isDotLottieContainer, type DotLottieContainer } from '@/lottie/dotlottie'

export interface TgsSource {
  kind: 'tgs'
}

export const TGS_SOURCE: TgsSource = { kind: 'tgs' }

/** True when the document came from a Telegram sticker. */
export function isTgsSource(value: unknown): value is TgsSource {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'tgs'
}

/** The dotLottie container of a document, if it came from a .lottie file. */
export function containerOf(value: unknown): DotLottieContainer | null {
  return isDotLottieContainer(value) ? value : null
}
