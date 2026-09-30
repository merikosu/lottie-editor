/**
 * What the support icon of an effect shows: player support (from `compat.ts`) and the problems
 * this particular effect has in some players.
 */
import { levelRank, type Level, type PlayerId } from '@/lottie/compat'
import {
  effectIssues,
  effectSupport,
  rendersInPreview,
  type EffectIssue,
  type EffectIssueCode,
} from '@/lottie/effects'
import type { Effect, Mask } from '@/lottie/types'

/** Order of the lines in the tooltip. */
export const LEVELS: Level[] = ['y', 'p', 'n', 'x', '?']

export interface SupportInfo {
  issues: EffectIssue[]
  /** 'danger' (breaks somewhere), 'warning' (the preview or a fixable problem), 'muted'. */
  tone: 'danger' | 'warning' | 'muted'
  /** Players by level; empty for a turned-off effect (the issue says what players do). */
  byLevel: Map<Level, PlayerId[]>
  /** No player renders it. */
  nowhere: boolean
}

const WEB: PlayerId[] = ['web-svg', 'web-canvas', 'web-html']

/** How an issue of this effect changes the general support of its type. */
const DOWNGRADES: Partial<Record<EffectIssueCode, [players: PlayerId[], level: Level]>> = {
  localizedNames: [['ios', 'android'], 'n'],
  enabledMissing: [['thorvg'], 'n'],
  missingMask: [WEB, 'x'],
  noControls: [WEB, 'x'],
}

/** What the icon shows for an effect, or null when every player handles it. */
export function supportInfo(effect: Effect, masks: readonly Mask[]): SupportInfo | null {
  const support = effectSupport(effect)
  const issues = effectIssues(effect, { masksProperties: masks as Mask[] })
  if (support.level === 'y' && issues.length === 0) return null
  const players = support.players.map(({ player, level }) => {
    let worst = level
    for (const issue of issues) {
      const down = DOWNGRADES[issue.code]
      if (down?.[0].includes(player) && levelRank(down[1]) > levelRank(worst)) worst = down[1]
    }
    return { player, level: worst }
  })
  const byLevel = new Map<Level, PlayerId[]>()
  if (effect.en !== 0) {
    for (const { player, level } of players) {
      const list = byLevel.get(level) ?? []
      list.push(player)
      byLevel.set(level, list)
    }
  }
  const nowhere = players.every((p) => p.level === 'n')
  const tone =
    issues.some((i) => i.severity === 'error') || players.some((p) => p.level === 'x')
      ? 'danger'
      : issues.length > 0 || !rendersInPreview(effect)
        ? 'warning'
        : 'muted'
  return { issues, tone, byLevel, nowhere }
}
