/** Preset values offered next to the fields. */

export const SIZE_PRESETS: readonly { w: number; h: number }[] = [
  { w: 256, h: 256 },
  { w: 512, h: 512 },
  { w: 1080, h: 1080 },
  { w: 1920, h: 1080 },
  { w: 1080, h: 1920 },
]

export const FPS_PRESETS: readonly number[] = [24, 25, 30, 50, 60]

/** Speeds relative to the file as opened (1 = 100%). */
export const SPEED_PRESETS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

/** Pause lengths in seconds. */
export const PAUSE_PRESETS: readonly number[] = [0.25, 0.5, 1, 2]

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

/** "16:9" for whole-number sizes with a small ratio, otherwise null. */
export function aspectRatio(w: number, h: number): string | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
  const d = gcd(w, h)
  const a = w / d
  const b = h / d
  return a <= 32 && b <= 32 ? `${a}:${b}` : null
}
