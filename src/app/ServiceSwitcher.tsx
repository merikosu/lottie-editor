import { Gauge, Paintbrush, PenTool } from 'lucide-react'
import { primaryShortcut, useCommands } from '@/commands/registry'
import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { navigate, useRoute, type Route } from './router'

const SERVICES: { route: Exclude<Route, 'home'>; icon: typeof PenTool; command: string }[] = [
  { route: 'edit', icon: PenTool, command: 'app.edit' },
  { route: 'customize', icon: Paintbrush, command: 'app.customize' },
  { route: 'optimize', icon: Gauge, command: 'app.optimize' },
]

/**
 * Top bar tabs for the three services. `compact` (the editor, whose menus need the room)
 * shows labels only on wide windows; tooltips always name the service.
 */
export function ServiceSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const route = useRoute()
  const commands = useCommands()
  const labels = {
    edit: t.app.services.edit,
    customize: t.app.services.customize,
    optimize: t.app.services.optimize,
  }
  const hints = {
    edit: t.app.services.editHint,
    customize: t.app.services.customizeHint,
    optimize: t.app.services.optimizeHint,
  }
  return (
    <nav
      aria-label={t.app.services.label}
      className="flex h-7 items-center gap-0.5 rounded-md bg-surface-2 p-0.5"
    >
      {SERVICES.map(({ route: r, icon: Icon, command }) => {
        const active = route === r
        return (
          <Tooltip
            key={r}
            content={`${labels[r]} — ${hints[r]}`}
            shortcut={primaryShortcut(commands.get(command))}
          >
            <button
              type="button"
              // The visible label is hidden on narrow windows: the name must not depend on it.
              aria-label={labels[r]}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(r)}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-surface-1 text-fg shadow-thumb dark:bg-surface-3'
                  : 'text-fg-subtle hover:text-fg',
              )}
            >
              <Icon size={14} />
              <span className={compact ? 'hidden min-[1480px]:inline' : 'hidden md:inline'}>
                {labels[r]}
              </span>
            </button>
          </Tooltip>
        )
      })}
    </nav>
  )
}
