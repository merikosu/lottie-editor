import { Braces, Check, ChevronRight, Copy, FileJson, TriangleAlert } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { layerDisplayName, shapeDisplayName } from '@/components/lottie/labels'
import { Button, IconButton, Spinner, Tooltip } from '@/components/ui'
import { useT, type Dict } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { getAt, isLayerPath, isShapePath, type NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'
import { getDoc, selectNodes, useDocument } from '@/store/document'
import { pathToAccessor } from '../json-scan'
import { getCodeController, useCodeStatus } from '../store'
import { SearchPanel } from './SearchPanel'
import { session, useSearchPanel } from './session'

/* ------------------------------- Breadcrumb ------------------------------- */

/** Friendly name for array items that are layers, shapes, assets, fonts or markers. */
function segmentName(doc: Animation | null, path: NodePath, t: Dict): string | null {
  if (!doc || typeof path[path.length - 1] !== 'number') return null
  const index = path[path.length - 1] as number
  if (isLayerPath(path)) {
    const layer = getAt<Layer>(doc, path)
    return layer && typeof layer === 'object' ? layerDisplayName(layer, index, t) : null
  }
  if (isShapePath(path)) {
    const item = getAt<ShapeItem>(doc, path)
    return item && typeof item === 'object' && typeof item.ty === 'string'
      ? shapeDisplayName(item, t)
      : null
  }
  const node = getAt<{ id?: unknown; nm?: unknown; fName?: unknown; cm?: unknown }>(doc, path)
  if (!node || typeof node !== 'object') return null
  if (path.length === 2 && path[0] === 'assets')
    return typeof node.nm === 'string' && node.nm
      ? node.nm
      : typeof node.id === 'string'
        ? node.id
        : null
  if (path.length === 3 && path[0] === 'fonts')
    return typeof node.fName === 'string' ? node.fName : null
  if (path.length === 2 && path[0] === 'markers')
    return typeof node.cm === 'string' ? node.cm : null
  return null
}

function Breadcrumb() {
  const t = useT()
  const path = useCodeStatus((s) => s.cursorPath)
  const line = useCodeStatus((s) => s.line)
  const col = useCodeStatus((s) => s.col)
  const dirty = useCodeStatus((s) => s.dirty)
  const notice = useCodeStatus((s) => s.notice)
  // Names come from the document; re-render when it changes.
  const doc = useDocument((s) => s.doc)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Long paths overflow to the left: keep the innermost segment in view.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && path) el.scrollLeft = el.scrollWidth
  }, [path])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(id)
  }, [copied])

  const segments = path ?? []

  const go = (prefix: NodePath) => {
    session.goTo(prefix)
    // Selecting follows the document's paths, which only match the text without a draft.
    const current = getDoc()
    if (
      !dirty &&
      current &&
      (isLayerPath(prefix) || isShapePath(prefix)) &&
      getAt(current, prefix)
    ) {
      session.selectFromEditor(prefix, (p) => selectNodes([p]))
    }
  }

  return (
    <div
      className="flex h-6 shrink-0 items-center gap-2 border-b border-line bg-surface-1 pr-1 pl-2 text-xs"
      aria-label={t.code.pathLabel}
      data-testid="code-breadcrumb"
    >
      <div
        ref={scrollRef}
        className="scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto"
      >
        <button
          type="button"
          onClick={() => go([])}
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <Braces size={12} className="shrink-0" />
          {path !== null && segments.length === 0 && <span>{t.code.root}</span>}
        </button>
        {segments.map((seg, i) => {
          const prefix = segments.slice(0, i + 1)
          const name = segmentName(doc, prefix, t)
          const last = i === segments.length - 1
          const selectable = !dirty && (isLayerPath(prefix) || isShapePath(prefix)) && name !== null
          const button = (
            <button
              type="button"
              onClick={() => go(prefix)}
              className={cn(
                'flex h-5 max-w-60 shrink-0 items-center gap-1 rounded-sm px-1 whitespace-nowrap hover:bg-hover hover:text-fg',
                last ? 'text-fg' : 'text-fg-subtle',
              )}
            >
              <span className="tabular-nums">{String(seg)}</span>
              {name && (
                <span className={cn('truncate', last ? 'text-fg-muted' : 'text-fg-faint')}>
                  {name}
                </span>
              )}
            </button>
          )
          return (
            <Fragment key={i}>
              <ChevronRight size={12} className="shrink-0 text-fg-faint" aria-hidden />
              {selectable ? (
                <Tooltip content={t.code.selectNode(name)} side="bottom">
                  {button}
                </Tooltip>
              ) : (
                button
              )}
            </Fragment>
          )
        })}
      </div>
      {notice ? (
        <output className="flex shrink-0 items-center gap-1 text-warning">
          <TriangleAlert size={12} />
          {notice}
        </output>
      ) : (
        <span className="shrink-0 text-fg-subtle tabular-nums">{t.code.position(line, col)}</span>
      )}
      <IconButton
        icon={copied ? Check : Copy}
        size="xs"
        label={t.code.copyPath}
        disabled={segments.length === 0}
        onClick={() => {
          void copyText(pathToAccessor(segments)).then((ok) => setCopied(ok))
        }}
      />
    </div>
  )
}

/* --------------------------------- Banners -------------------------------- */

function StaleBanner() {
  const t = useT()
  const visible = useCodeStatus((s) => s.stale && s.dirty && !s.staleDismissed)
  if (!visible) return null
  return (
    <div
      aria-live="polite"
      className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface-2 px-3 py-1 text-xs"
      data-testid="code-stale"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 text-fg-muted">
        <TriangleAlert size={14} className="shrink-0 text-warning" />
        <Tooltip content={t.code.changedOutsideHint}>
          <span className="truncate">{t.code.changedOutside}</span>
        </Tooltip>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="ghost" onClick={() => session.dismissStale()}>
          {t.code.keepEditing}
        </Button>
        <Button size="xs" variant="secondary" onClick={() => getCodeController()?.revert()}>
          {t.code.reload}
        </Button>
      </span>
    </div>
  )
}

function LargeDocNotice({ size }: { size: number }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-surface-1 px-6 text-center">
      <FileJson size={20} className="mb-1 text-fg-faint" />
      <div className="text-sm font-medium text-fg-muted">{t.code.largeTitle}</div>
      <div className="max-w-72 text-xs text-fg-subtle">
        {t.code.largeDescription(formatBytes(size))}
      </div>
      {busy ? (
        <div className="mt-2 flex h-7 items-center gap-2 text-xs text-fg-subtle">
          <Spinner />
          {t.common.loading}
        </div>
      ) : (
        <Button
          className="mt-2"
          size="md"
          onClick={() => {
            setBusy(true)
            getCodeController()?.openLarge()
          }}
        >
          {t.code.largeOpen}
        </Button>
      )}
    </div>
  )
}

/* --------------------------------- Editor --------------------------------- */

/** CodeMirror host (lazy chunk). The session keeps the editor state between mounts. */
export default function JsonEditor() {
  const hostRef = useRef<HTMLDivElement>(null)
  const searchDom = useSearchPanel((s) => s.dom)
  const largeDoc = useCodeStatus((s) => s.largeDoc)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    session.mount(host)
    return () => session.unmount()
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <StaleBanner />
      <Breadcrumb />
      <div
        ref={hostRef}
        className="le-code-editor min-h-0 flex-1 overflow-hidden"
        data-testid="code-editor"
      />
      {largeDoc !== null && <LargeDocNotice size={largeDoc} />}
      {searchDom && createPortal(<SearchPanel />, searchDom)}
    </div>
  )
}
