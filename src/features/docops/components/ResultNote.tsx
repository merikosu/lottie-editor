import { Check, Info, TriangleAlert } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { clearResult, useDocopsState, type ResultScope } from '../store'

const RESULT_MS = 6000

/**
 * One-line inline feedback after an operation (instead of a toast), falling back to a quiet
 * hint that reserves the space, so nothing jumps when a result appears.
 */
export function ResultNote({
  scope,
  fallback,
  className,
}: {
  scope: ResultScope
  fallback?: ReactNode
  className?: string
}) {
  const result = useDocopsState((s) => (s.result?.scope === scope ? s.result : null))

  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => clearResult(result.id), RESULT_MS)
    return () => clearTimeout(timer)
  }, [result])

  // Without a fallback hint the line only exists while a result is shown.
  if (!result && !fallback) return null
  const Icon = result?.tone === 'warning' ? TriangleAlert : result?.tone === 'info' ? Info : Check
  return (
    <output
      aria-live="polite"
      className={cn('flex min-h-4 items-start gap-1.5 text-xs', className)}
    >
      {result ? (
        <>
          <Icon
            size={12}
            className={cn(
              'mt-0.5 shrink-0',
              result.tone === 'done' && 'text-success',
              result.tone === 'warning' && 'text-warning',
              result.tone === 'info' && 'text-fg-subtle',
            )}
          />
          <span key={result.id} className="min-w-0 animate-fade-in text-fg-muted tabular-nums">
            {result.text}
          </span>
        </>
      ) : (
        fallback && <span className="min-w-0 text-fg-subtle">{fallback}</span>
      )}
    </output>
  )
}
