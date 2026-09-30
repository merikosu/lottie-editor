/**
 * Number precision of a document, read from its JSON text: how many decimals its fractional
 * numbers typically carry (the median), for the before/after comparison.
 */

/** Median count of decimal digits over the fractional numbers of a JSON text (0 when none). */
export function typicalDecimals(json: string): number {
  // Histogram of fraction lengths: numbers in Lottie files rarely carry more than 20 decimals.
  const counts = Array.from({ length: 24 }, () => 0)
  let total = 0
  // A number's fraction: digits after the point (an exponent ends it). A number is never glued
  // to a letter, so base64 data does not count; a name such as "Layer 1.5" does, as noise the
  // median ignores.
  const re = /(?<![\w.])-?\d+\.(\d+)/g
  for (let m = re.exec(json); m; m = re.exec(json)) {
    const digits = m[1].replace(/0+$/, '').length
    if (!digits) continue
    counts[Math.min(digits, counts.length - 1)]++
    total++
  }
  if (!total) return 0
  let seen = 0
  for (let d = 0; d < counts.length; d++) {
    seen += counts[d]
    if (seen * 2 >= total) return d
  }
  return counts.length - 1
}
