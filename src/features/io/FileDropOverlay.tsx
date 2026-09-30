import { FileDown, Gauge, ImageOff, ImagePlus, Replace } from 'lucide-react'
import { useEffect, useState } from 'react'
import { currentRoute, useRoute } from '@/app/router'
import { dispatchFiles } from '@/commands/files'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { closeDialog, useUi } from '@/store/ui'
import { collectFiles } from './dropFiles'
import { useIo, type DropKind } from './store'

/**
 * Safety net: hide the overlay when no dragover arrived for this long (a drag cancelled in a way
 * that skipped dragleave). Browsers repeat dragover every 50–350 ms while the pointer rests.
 */
const STALE_AFTER_MS = 1200

function isFileDrag(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

/** Kinds where a drop would do nothing: the cursor says so and the drop is not accepted. */
const BLOCKED: ReadonlySet<DropKind> = new Set(['images-no-doc', 'optimize-images'])

/** What dropping the dragged items would do, from their types (known while dragging). */
function dropKindOf(dt: DataTransfer | null): DropKind {
  const items = Array.from(dt?.items ?? []).filter((i) => i.kind === 'file')
  // Folders and some browsers report no type: those count as files to open.
  const imagesOnly = items.length > 0 && items.every((i) => i.type.startsWith('image/'))
  if (currentRoute() === 'optimize') return imagesOnly ? 'optimize-images' : 'optimize'
  if (!imagesOnly) return 'open'
  if (!useDocument.getState().doc) return 'images-no-doc'
  // On the Customize page a dropped picture replaces the selected element (see customize).
  return currentRoute() === 'customize' ? 'customize-images' : 'images'
}

function setDrag(drag: DropKind | null): void {
  if (useIo.getState().drag !== drag) useIo.setState({ drag })
  const active = drag !== null
  if (useUi.getState().dropActive !== active) useUi.setState({ dropActive: active })
}

/**
 * Whole-window drop target for files. It is only a visual layer (pointer-events: none), so drop
 * targets inside the page (an image asset row, the home page's service cards) still receive the
 * drop; those call preventDefault and this handler then leaves the drop alone. On the home page
 * the service cards show where files go, so the overlay steps aside for animation files.
 */
export function FileDropOverlay() {
  const t = useT()
  const route = useRoute()
  const fileName = useDocument((s) => s.meta?.fileName)
  const autosave = usePrefs((s) => s.autosave)
  const kind = useIo((s) => s.drag)
  // A drop target of the page itself is under the pointer (e.g. an image asset row, which
  // replaces that image): the overlay steps aside so it does not claim that drop.
  const [overTarget, setOverTarget] = useState(false)

  useEffect(() => {
    let staleTimer = 0
    let checkTimer = 0
    /** The last dragover, until it reaches the window: if it never does, the page kept it. */
    let pending: DragEvent | null = null
    // Every dragenter (the pointer crossing into an element) is paired with a dragleave of the
    // element it left, the new one first: the count drops to zero only when the drag leaves the
    // window or is cancelled. Moving between panels never makes the overlay blink.
    let depth = 0
    const hide = () => {
      window.clearTimeout(staleTimer)
      window.clearTimeout(checkTimer)
      depth = 0
      pending = null
      setOverTarget(false)
      setDrag(null)
    }
    const show = (e: DragEvent) => {
      const next = dropKindOf(e.dataTransfer)
      setDrag(next)
      if (e.dataTransfer) e.dataTransfer.dropEffect = BLOCKED.has(next) ? 'none' : 'copy'
      window.clearTimeout(staleTimer)
      staleTimer = window.setTimeout(hide, STALE_AFTER_MS)
    }
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth++
      show(e)
    }
    const onDragOverCapture = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      pending = e
      // The drag is alive even while a target of the page handles (and stops) its dragovers.
      window.clearTimeout(staleTimer)
      staleTimer = window.setTimeout(hide, STALE_AFTER_MS)
      window.clearTimeout(checkTimer)
      // After the whole dispatch: did the event reach the window (below) or did the page keep it?
      checkTimer = window.setTimeout(() => setOverTarget(pending === e), 0)
    }
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      pending = null
      // Without this the browser would open the dropped file in the tab.
      e.preventDefault()
      show(e)
    }
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) hide()
    }
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e) || !e.dataTransfer) return
      const handled = e.defaultPrevented
      e.preventDefault()
      hide()
      if (handled) return
      // The overlay covered any open dialog: dropping means "open this" instead.
      if (useUi.getState().dialog) closeDialog()
      void collectFiles(e.dataTransfer).then((files) => {
        if (files.length) void dispatchFiles(files)
      })
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOverCapture, true)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', hide)
    return () => {
      window.clearTimeout(staleTimer)
      window.clearTimeout(checkTimer)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOverCapture, true)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', hide)
      setDrag(null)
    }
  }, [])

  if (!kind || overTarget || (route === 'home' && kind === 'open')) return null
  const blocked = BLOCKED.has(kind)
  let Icon = FileDown
  let title = t.io.drop.open
  let hint: string | null = fileName
    ? autosave
      ? t.io.drop.replaces(fileName)
      : t.io.drop.replacesNoAutosave(fileName)
    : null
  switch (kind) {
    case 'images':
      Icon = ImagePlus
      title = t.io.drop.images
      hint = t.io.drop.imagesHint
      break
    case 'customize-images':
      Icon = Replace
      title = t.io.drop.customizeImages
      hint = t.io.drop.customizeImagesHint
      break
    case 'images-no-doc':
      Icon = ImageOff
      title = t.io.drop.imagesNoDoc
      hint = t.io.drop.imagesNoDocHint
      break
    case 'optimize':
      Icon = Gauge
      title = t.io.drop.optimize
      hint = t.io.drop.optimizeHint
      break
    case 'optimize-images':
      Icon = ImageOff
      title = t.io.drop.optimizeImages
      hint = t.io.drop.optimizeImagesHint
      break
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100] animate-fade-in bg-canvas/60"
      data-testid="drop-overlay"
      data-kind={kind}
      aria-hidden
    >
      <div
        className={cn(
          'absolute inset-2 rounded-xl border border-dashed',
          blocked ? 'border-line-strong' : 'border-accent bg-accent/5',
        )}
      />
      <div className="absolute inset-0 flex items-center justify-center p-8">
        <div className="flex max-w-[380px] items-center gap-3 rounded-lg bg-surface-3 px-4 py-3 shadow-popover">
          <Icon
            size={18}
            className={cn('shrink-0', blocked ? 'text-fg-muted' : 'text-accent-text')}
          />
          <div className="min-w-0">
            <div className="text-base font-medium text-fg">{title}</div>
            {hint && <div className="mt-0.5 truncate text-xs text-fg-muted">{hint}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
