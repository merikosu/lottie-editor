/** Text colors of severities and support levels (notes stay neutral: status colors are for problems). */
import type { Level } from '@/lottie/compat'
import type { Severity } from '@/lottie/validate'

export const SEVERITY_TEXT: Record<Severity, string> = {
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-fg-subtle',
}

export const LEVEL_TEXT: Record<Level, string> = {
  y: 'text-success',
  x: 'text-danger',
  n: 'text-warning',
  p: 'text-fg-subtle',
  '?': 'text-fg-subtle',
}
