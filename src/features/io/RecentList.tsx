import { Download, FileJson, FolderOpen, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import {
  Tooltip,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
} from '@/components/ui'
import { getT, useLanguage, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { downloadBlob } from '@/lib/download'
import type { DocumentRoute } from './dialog-ids'
import { buildDownload } from './download'
import { describeOpenError } from './messages'
import { notifyError } from './notify'
import { openRecent, removeRecentEntry } from './session'
import { markExported, readDocument, type RecentEntry } from './storage'
import { setRecents } from './store'
import { formatDuration, formatFileSize, formatRelativeTime } from './format'
import { TruncatedText } from './TruncatedText'

const COLLAPSED_COUNT = 5

async function downloadRecent(entry: RecentEntry): Promise<void> {
  const t = getT()
  try {
    const data = await readDocument(entry.id)
    if (!data) throw new Error('missing')
    const { blob, fileName } = buildDownload(data.stored.doc, data.stored.meta)
    downloadBlob(blob, fileName)
    if (entry.dirty) setRecents(await markExported(entry.id))
  } catch (err) {
    notifyError(describeOpenError(err, entry.fileName, t))
  }
}

/** Re-renders every minute so "3 minutes ago" stays true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

interface RowOptions {
  /** Page to open the file on (see `revealDocument`). */
  route?: DocumentRoute
  /** Extra context menu items (e.g. "Open in Customize" on the home page), before "Download copy". */
  menuItems?: (entry: RecentEntry) => ReactNode
}

function RecentRow({
  entry,
  now,
  route,
  menuItems,
}: { entry: RecentEntry; now: number } & RowOptions) {
  const t = useT()
  const language = useLanguage()
  const when = formatRelativeTime(
    entry.editedAt ?? entry.openedAt,
    language,
    t.io.time.justNow,
    now,
  )
  const time = entry.edited && entry.editedAt ? t.io.recent.edited(when) : t.io.recent.opened(when)
  const meta = [
    `${entry.width} × ${entry.height}`,
    `${entry.fps} ${t.common.fps}`,
    `${formatDuration(entry.frames, entry.fps, language)} ${t.common.secondsShort}`,
    entry.size ? formatFileSize(entry.size, language, t.io.units) : null,
    entry.animationId ? entry.animationId : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li className="group relative flex h-14 items-center">
          <button
            type="button"
            data-testid="recent-row"
            onClick={() => void openRecent(entry, route)}
            className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-left transition-colors duration-100 group-data-[state=open]:bg-hover hover:bg-hover focus-visible:outline-offset-[-2px]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--le-line)]">
              {entry.thumbnail ? (
                <img
                  src={entry.thumbnail}
                  alt=""
                  className="size-full object-contain p-0.5"
                  draggable={false}
                />
              ) : (
                <FileJson size={16} className="text-fg-faint" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <TruncatedText text={entry.fileName} className="text-sm font-medium text-fg" />
                {entry.dirty && (
                  <Tooltip content={t.app.unsaved}>
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-fg-muted"
                      aria-label={t.app.unsaved}
                    />
                  </Tooltip>
                )}
              </span>
              <span className="truncate text-xs text-fg-subtle tabular-nums">{meta}</span>
            </span>
            <span className="shrink-0 pl-4 text-xs whitespace-nowrap text-fg-subtle transition-opacity duration-100 group-focus-within:opacity-0 group-hover:opacity-0">
              {time}
            </span>
          </button>
          <IconButton
            icon={X}
            label={t.io.recent.remove}
            tooltipSide="left"
            onClick={() => void removeRecentEntry(entry.id)}
            className="absolute right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          />
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuItem kind="context" icon={FolderOpen} onSelect={() => void openRecent(entry, route)}>
          {t.io.recent.open}
        </MenuItem>
        {menuItems?.(entry)}
        <MenuItem kind="context" icon={Download} onSelect={() => void downloadRecent(entry)}>
          {t.io.recent.download}
        </MenuItem>
        <MenuSeparator kind="context" />
        <MenuItem kind="context" icon={X} onSelect={() => void removeRecentEntry(entry.id)}>
          {t.io.recent.remove}
        </MenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Recent files stored in this browser, newest first. */
export function RecentList({
  entries,
  className,
  route,
  menuItems,
}: { entries: RecentEntry[]; className?: string } & RowOptions) {
  const t = useT()
  const now = useNow()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_COUNT)
  const hidden = entries.length - visible.length

  return (
    <div className={cn('flex flex-col', className)}>
      <ul className="flex flex-col">
        {visible.map((entry) => (
          <RecentRow key={entry.id} entry={entry} now={now} route={route} menuItems={menuItems} />
        ))}
      </ul>
      {(hidden > 0 || expanded) && entries.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 h-7 self-start rounded-md px-2 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg"
        >
          {expanded ? t.io.welcome.showLess : t.io.welcome.showMore(hidden)}
        </button>
      )}
    </div>
  )
}
