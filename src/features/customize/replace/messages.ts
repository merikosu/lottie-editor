/**
 * Translated explanations of what an SVG import left out (shared by the Replace dialog and the
 * "Import SVG as layer" command).
 */
import type { Dict } from '@/i18n'
import type { SvgWarning } from '@/lottie/svg'

/**
 * One line per kind of limitation, in the order they were found. Several elements with the same
 * problem (two `<text>` elements, say) say it once.
 */
export function svgWarningLines(warnings: readonly SvgWarning[], t: Dict): string[] {
  const lines = new Set<string>()
  for (const w of warnings) lines.add(t.customize.replace.svgWarnings[w.code])
  return [...lines]
}
