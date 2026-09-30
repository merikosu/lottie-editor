import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { DocumentRoute } from './dialog-ids'
import { RecentList } from './RecentList'
import { clearAllRecents } from './session'
import type { RecentEntry } from './storage'
import { useIo } from './store'

/**
 * "Recent" section of the start pages: the recent files with an inline "Clear" confirmation.
 * Hidden while there is nothing to list. `excludeId` leaves out a document shown elsewhere on the
 * page (the home page shows the open one on its own).
 */
export function RecentSection({
  excludeId,
  route,
  menuItems,
  className,
}: {
  excludeId?: string
  /** Page to open the files on (see `revealDocument`). */
  route?: DocumentRoute
  /** Extra context menu items for a row. */
  menuItems?: (entry: RecentEntry) => ReactNode
  className?: string
}) {
  const t = useT()
  const recents = useIo((s) => s.recents)
  const [confirming, setConfirming] = useState(false)
  const entries = excludeId ? recents?.filter((r) => r.id !== excludeId) : recents
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setConfirming(false)
  }
  if (!entries?.length) return null
  return (
    <section aria-labelledby="le-recent-title" className={className}>
      <div className="mb-2 flex h-6 items-center justify-between gap-3 px-2">
        <h2 id="le-recent-title" className="text-sm font-semibold text-fg">
          {t.io.welcome.recent}
        </h2>
        {confirming ? (
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="truncate text-fg-muted">{t.io.welcome.clearConfirm}</span>
            {/* The safe answer takes the focus, so Enter never clears by accident; Escape backs out. */}
            <Button
              size="xs"
              variant="ghost"
              autoFocus
              onClick={() => setConfirming(false)}
              onKeyDown={onEscape}
            >
              {t.common.cancel}
            </Button>
            <Button
              size="xs"
              variant="danger"
              onKeyDown={onEscape}
              onClick={() => {
                setConfirming(false)
                void clearAllRecents()
              }}
            >
              {t.io.welcome.clearConfirmAction}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            // -mr-1.5: the label lines up with the times at the end of the rows.
            className={cn(
              '-mr-1.5 h-6 rounded-md px-1.5 text-xs text-fg-subtle',
              'transition-colors duration-100 hover:bg-hover hover:text-fg',
            )}
          >
            {t.io.welcome.clearRecents}
          </button>
        )}
      </div>
      <RecentList entries={entries} route={route} menuItems={menuItems} />
    </section>
  )
}
