/**
 * Keycap rendering for the shortcuts sheet: command shortcuts (alternates joined with "or")
 * and gestures (held modifiers + a pointer action).
 */
import { Fragment, type ReactNode } from 'react'
import { Kbd } from '@/components/ui'
import { useT } from '@/i18n'
import { isMac } from '@/lib/platform'
import { modifierLabel, type Gesture } from './gestures'

/** Same look as <Kbd variant="caps">, for keys that are not full shortcuts (a lone modifier). */
function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-surface-2 px-1 font-sans text-2xs font-medium text-fg-muted shadow-[inset_0_-1px_0_var(--le-line-strong)]">
      {children}
    </kbd>
  )
}

function Or() {
  const t = useT()
  return <span className="px-0.5 text-xs text-fg-faint">{t.workspace.shortcuts.or}</span>
}

export function ShortcutKeys({ shortcuts }: { shortcuts: readonly string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shortcuts.map((sc, i) => (
        <Fragment key={sc}>
          {i > 0 && <Or />}
          <Kbd shortcut={sc} variant="caps" />
        </Fragment>
      ))}
    </span>
  )
}

export function GestureKeys({ gesture }: { gesture: Gesture }) {
  const t = useT()
  const actions = t.workspace.shortcuts.actions
  return (
    <span className="flex shrink-0 items-center gap-1">
      {gesture.combos.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <Or />}
          {combo.keys.map((key) => (
            <Fragment key={key}>
              <Keycap>{modifierLabel(key, isMac)}</Keycap>
              <span className="text-xs text-fg-faint">+</span>
            </Fragment>
          ))}
          <span className="text-xs whitespace-nowrap text-fg-muted">{actions[combo.action]}</span>
        </Fragment>
      ))}
    </span>
  )
}
