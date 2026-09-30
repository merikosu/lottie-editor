import { ImageOff } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { create } from 'zustand'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'

/** Theme-aware transparency checkerboard, sized for small previews. */
const CHECKER: CSSProperties = {
  backgroundColor: 'var(--le-checker-a)',
  backgroundImage:
    'conic-gradient(var(--le-checker-b) 25%, transparent 0 50%, var(--le-checker-b) 0 75%, transparent 0)',
  backgroundSize: '10px 10px',
}

export function Checker({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={className} style={CHECKER}>
      {children}
    </div>
  )
}

/* ---------------------------- Shared preview ----------------------------- */

interface PreviewTarget {
  el: HTMLElement
  src: string
  w?: number
  h?: number
  bytes?: number | null
}

/** One hover preview for the whole panel (instead of one hover card per row). */
const usePreview = create<{ target: PreviewTarget | null }>()(() => ({ target: null }))
let previewTimer = 0

function schedulePreview(target: PreviewTarget): void {
  window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => usePreview.setState({ target }), 450)
}

function cancelPreview(): void {
  window.clearTimeout(previewTimer)
  if (usePreview.getState().target) usePreview.setState({ target: null })
}

/** Popper anchor that follows the hovered thumbnail. */
const anchor = {
  current: {
    getBoundingClientRect: () =>
      usePreview.getState().target?.el.getBoundingClientRect() ?? new DOMRect(),
  },
}

/** Mount once per panel: shows the enlarged image of the hovered thumbnail. */
export function ThumbnailPreview() {
  const t = useT()
  const target = usePreview((s) => s.target)
  return (
    <Popover open={target !== null && target.el.isConnected}>
      <PopoverAnchor virtualRef={anchor} />
      {target && (
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="pointer-events-none flex flex-col gap-2 p-2"
        >
          <div
            className="flex max-h-60 max-w-60 min-w-24 items-center justify-center overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--le-line)]"
            style={CHECKER}
          >
            <img
              src={target.src}
              alt=""
              draggable={false}
              className="max-h-60 max-w-60 object-contain"
            />
          </div>
          {target.w !== undefined && target.h !== undefined && (
            <div className="px-0.5 text-xs text-fg-muted tabular-nums">
              {t.assets.preview(target.w, target.h)}
              {target.bytes ? ` · ${formatBytes(target.bytes)}` : ''}
            </div>
          )}
        </PopoverContent>
      )}
    </Popover>
  )
}

/* ------------------------------- Thumbnail -------------------------------- */

interface ImageThumbProps {
  src: string | null
  w?: number
  h?: number
  bytes?: number | null
  className?: string
}

/** 36px image thumbnail on a checkerboard; hovering it shows a larger preview. */
export function ImageThumb({ src, w, h, bytes, className }: ImageThumbProps) {
  const [broken, setBroken] = useState<string | null>(null)
  const failed = !src || broken === src
  return (
    <div
      onPointerEnter={(e) => {
        // Anchor to the whole row so the preview opens beside the panel, not over the row's text.
        const el = e.currentTarget.closest<HTMLElement>('[data-asset-id]') ?? e.currentTarget
        if (!failed && src) schedulePreview({ el, src, w, h, bytes })
      }}
      onPointerLeave={cancelPreview}
      onPointerDown={cancelPreview}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--le-line)]',
        failed && 'bg-surface-2',
        className,
      )}
      style={failed ? undefined : CHECKER}
    >
      {failed ? (
        <ImageOff size={14} className="text-fg-faint" />
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(src)}
          className="max-h-full max-w-full object-contain"
        />
      )}
    </div>
  )
}
