import { CircleAlert, Grid2x2, Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, SegmentedControl } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { isMac } from '@/lib/platform'
import type { NodePath } from '@/lottie/path'
import { replaceTargetKind } from '@/lottie/replace'
import { clearSelection, getDoc, selectNodes } from '@/store/document'
import { setPrefs, usePrefs, type CanvasBackground } from '@/store/prefs'
import { PreviewController, selectedNode } from './controller'
import { PlayButton, Scrubber } from './Scrubber'

/** Fixed preview colors (independent of the UI theme, like the editor canvas). */
const DARK_BACKGROUND = '#1b1c1f'
const LIGHT_BACKGROUND = '#ffffff'

type PreviewBackground = Exclude<CanvasBackground, 'custom'>

export interface PreviewProps {
  /** Element a click on the tagged stack (innermost first) picks. */
  pick: (stack: NodePath[], deep: boolean) => NodePath | null
  nameOf: (path: NodePath) => string
  /** Double-click on an element (e.g. open the Replace dialog). */
  onActivate: (path: NodePath) => void
  className?: string
}

/** Artboard background: the editor's canvas background preference. */
function useBackground(): { mode: CanvasBackground; color: string | null } {
  const mode = usePrefs((s) => s.canvasBackground)
  const custom = usePrefs((s) => s.canvasColor)
  const color =
    mode === 'dark'
      ? DARK_BACKGROUND
      : mode === 'light'
        ? LIGHT_BACKGROUND
        : mode === 'custom'
          ? custom
          : null
  return { mode, color }
}

/**
 * The live preview: the animation plays on an artboard fitted into the column; hovering shows
 * what a click would pick, a click selects it. A compact transport sits underneath.
 */
export function Preview({ pick, nameOf, onActivate, className }: PreviewProps) {
  const t = useT()
  const areaRef = useRef<HTMLDivElement>(null)
  const artboardRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const outlinesRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<PreviewController | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const background = useBackground()
  // Latest callbacks for the controller (it is created once).
  const callbacks = useRef({ pick, nameOf, onActivate })
  useEffect(() => {
    callbacks.current = { pick, nameOf, onActivate }
  })

  useEffect(() => {
    const area = areaRef.current
    const artboard = artboardRef.current
    const host = hostRef.current
    const outlines = outlinesRef.current
    if (!area || !artboard || !host || !outlines) return
    const controller = new PreviewController(
      { area, artboard, host, outlines },
      {
        pick: (stack, deep) => callbacks.current.pick(stack, deep),
        nameOf: (path) => callbacks.current.nameOf(path),
        onActivate: (path) => callbacks.current.onActivate(path),
        selected: () => {
          const path = selectedNode()
          const doc = getDoc()
          return path && doc && replaceTargetKind(doc, path) ? path : null
        },
        onPick: (path) => {
          if (path) selectNodes([path])
          else clearSelection()
        },
        onStatus: ({ error: e }) => setError(e),
      },
    )
    controllerRef.current = controller
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [])

  const backgroundOptions: { value: PreviewBackground; icon: typeof Grid2x2; title: string }[] = [
    { value: 'checker', icon: Grid2x2, title: t.customize.preview.backgrounds.checker },
    { value: 'dark', icon: Moon, title: t.customize.preview.backgrounds.dark },
    { value: 'light', icon: Sun, title: t.customize.preview.backgrounds.light },
  ]

  return (
    <section
      aria-label={t.customize.preview.label}
      className={cn('flex min-w-0 flex-col bg-canvas', className)}
      data-testid="customize-preview"
    >
      <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={artboardRef}
          className={cn(
            'absolute overflow-visible shadow-[0_0_0_1px_var(--le-line)]',
            !background.color && 'checkerboard',
          )}
          style={background.color ? { background: background.color } : undefined}
          data-testid="customize-artboard"
        >
          <div ref={hostRef} className="absolute inset-0 overflow-hidden" />
          <div ref={outlinesRef} className="pointer-events-none absolute inset-0" />
        </div>
        {error && (
          <div className="absolute inset-x-0 top-3 flex justify-center px-4">
            <div className="flex max-w-md items-center gap-2 rounded-lg bg-surface-3 py-1.5 pr-1.5 pl-3 text-sm shadow-popover">
              <CircleAlert size={14} className="shrink-0 text-danger" />
              <span className="min-w-0 truncate">{t.customize.preview.failed}</span>
              <Button size="sm" variant="ghost" onClick={() => controllerRef.current?.reload()}>
                {t.customize.preview.retry}
              </Button>
            </div>
          </div>
        )}
        <p className="pointer-events-none absolute bottom-2 left-3 truncate text-xs text-fg-faint">
          {t.customize.preview.pickHint}
          <span aria-hidden className="px-1.5">
            ·
          </span>
          {t.customize.preview.deepHint(isMac ? '⌘' : 'Ctrl')}
        </p>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line bg-surface-1 pr-2 pl-1.5">
        <PlayButton />
        <Scrubber className="flex-1" />
        <div className="mx-1 h-4 w-px bg-line-strong" aria-hidden />
        <SegmentedControl<PreviewBackground>
          value={background.mode === 'custom' ? ('' as PreviewBackground) : background.mode}
          onValueChange={(canvasBackground) => setPrefs({ canvasBackground })}
          options={backgroundOptions}
          aria-label={t.customize.preview.background}
        />
      </div>
    </section>
  )
}
