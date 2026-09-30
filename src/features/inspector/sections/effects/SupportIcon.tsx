/**
 * Player support of an effect: a small warning icon with a tooltip listing the players by
 * support level (from `compat.ts`) and the problems this particular effect has in some
 * players. Nothing is shown for effects every player handles.
 */
import { TriangleAlert } from 'lucide-react'
import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { Level } from '@/lottie/compat'
import { LEVELS, type SupportInfo } from './support'

export function SupportIcon({ info }: { info: SupportInfo }) {
  const t = useT()
  const ts = t.inspector.effects.support
  const levelLabel: Record<Level, string> = {
    y: ts.works,
    p: ts.partial,
    n: ts.ignored,
    x: ts.breaks,
    '?': ts.unverified,
  }
  const lines = info.issues.map((i) => t.inspector.effects.issues[i.code])
  const players = LEVELS.flatMap((level) => {
    const list = info.byLevel.get(level)
    if (!list?.length) return []
    return [{ level, label: levelLabel[level], names: list.map((p) => ts.players[p] ?? p) }]
  })
  const summary = [...lines, ...players.map((p) => `${p.label}: ${p.names.join(', ')}`)].join(' ')

  return (
    <Tooltip
      side="left"
      className="max-w-72 items-start"
      content={
        <span className="flex flex-col gap-1.5 py-0.5">
          {lines.map((line) => (
            <span key={line} className="block text-pretty text-fg">
              {line}
            </span>
          ))}
          {info.nowhere ? (
            <span className="block text-fg-muted">{ts.nowhere}</span>
          ) : players.length === 0 ? null : (
            <span className="flex flex-col gap-0.5">
              {players.map((p) => (
                <span key={p.level} className="block text-pretty">
                  <span className="text-fg-muted">{p.label}: </span>
                  <span className="text-fg">{p.names.join(', ')}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      }
    >
      <button
        type="button"
        aria-label={summary}
        data-testid="effect-support"
        className={cn(
          'inline-flex size-4 shrink-0 cursor-default items-center justify-center rounded-xs',
          info.tone === 'danger' && 'text-danger',
          info.tone === 'warning' && 'text-warning',
          info.tone === 'muted' && 'text-fg-faint hover:text-fg-muted',
        )}
      >
        <TriangleAlert size={12} />
      </button>
    </Tooltip>
  )
}
