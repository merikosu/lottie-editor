/**
 * Viewport controls on the right side of the center panel header:
 * background · renderer | artboard outline · compare | zoom.
 *
 * The toolbar is a size container: when the center panel gets narrow, the least used
 * controls hide first (all of them stay available in the View menu and the canvas menu).
 */
import { SquareDashed, SquareSplitHorizontal } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { setPrefs, usePrefs } from '@/store/prefs'
import { BackgroundPicker } from './components/BackgroundPicker'
import { RendererMenu } from './components/RendererMenu'
import { ZoomMenu } from './components/ZoomMenu'
import { toggleCompare, useViewport } from './store'

function Separator({ className }: { className?: string }) {
  return <div aria-hidden className={cn('mx-1 h-4 w-px shrink-0 bg-line-strong', className)} />
}

export function ViewportToolbar() {
  const t = useT()
  const hasDoc = useDocument((s) => s.doc !== null)
  const hasOriginal = useDocument((s) => s.original !== null)
  const showBounds = usePrefs((s) => s.showBounds)
  const compare = useViewport((s) => s.compare)
  if (!hasDoc) return null
  return (
    <div className="@container/vt flex min-w-0 flex-1 justify-end" data-testid="viewport-toolbar">
      <div className="flex items-center gap-0.5">
        <div className="flex items-center gap-0.5 @max-[150px]/vt:hidden">
          <BackgroundPicker />
          <div className="flex items-center @max-[250px]/vt:hidden">
            <RendererMenu />
          </div>
          <Separator />
        </div>
        <div className="@max-[200px]/vt:hidden">
          <IconButton
            size="md"
            icon={SquareDashed}
            label={t.viewport.bounds}
            active={showBounds}
            onClick={() => setPrefs({ showBounds: !showBounds })}
            data-testid="toggle-bounds"
          />
        </div>
        <IconButton
          size="md"
          icon={SquareSplitHorizontal}
          label={t.viewport.compare}
          active={compare && hasOriginal}
          disabled={!hasOriginal}
          onClick={toggleCompare}
          data-testid="toggle-compare"
        />
        <Separator className="@max-[110px]/vt:hidden" />
        <ZoomMenu variant="toolbar" />
      </div>
    </div>
  )
}
