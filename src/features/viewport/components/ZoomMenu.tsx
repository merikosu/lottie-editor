/**
 * Zoom percentage button + menu (toolbar and the canvas corner share it).
 */
import { ChevronDown, Maximize, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  Tooltip,
} from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { formatZoom, sameZoom } from '../lib/camera'
import { useViewport, zoomStep, zoomTo, zoomToFit, zoomToNodes } from '../store'
import { chipClass } from './PaneChrome'

const PRESETS = [0.5, 1, 2] as const

export function ZoomMenu({ variant }: { variant: 'toolbar' | 'chip' }) {
  const t = useT()
  const zoom = useViewport((s) => s.camera.zoom)
  const hasSelection = useDocument((s) => s.selection.nodes.length > 0)
  const label = formatZoom(zoom)

  const trigger =
    variant === 'toolbar' ? (
      <button
        type="button"
        data-testid="zoom-menu"
        className="inline-flex h-7 min-w-[64px] shrink-0 items-center justify-end gap-1 rounded-md pr-1.5 pl-2 text-sm text-fg-muted tabular-nums transition-colors duration-100 hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
      >
        {label}
        <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
      </button>
    ) : (
      <button
        type="button"
        data-testid="zoom-chip"
        className={cn(
          chipClass,
          'transition-colors duration-100 hover:text-fg data-[state=open]:text-fg',
        )}
      >
        {label}
      </button>
    )

  return (
    <DropdownMenu modal={false}>
      <Tooltip content={t.viewport.zoom} side={variant === 'chip' ? 'top' : 'bottom'}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        side={variant === 'chip' ? 'top' : 'bottom'}
        className="min-w-[216px]"
      >
        <MenuItem icon={ZoomIn} shortcut="=" onSelect={() => zoomStep(1)}>
          {t.viewport.zoomIn}
        </MenuItem>
        <MenuItem icon={ZoomOut} shortcut="-" onSelect={() => zoomStep(-1)}>
          {t.viewport.zoomOut}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Maximize} shortcut="shift+1" onSelect={zoomToFit}>
          {t.viewport.zoomFit}
        </MenuItem>
        <MenuItem
          icon={ScanSearch}
          shortcut="shift+2"
          disabled={!hasSelection}
          onSelect={() => void zoomToNodes(useDocument.getState().selection.nodes)}
        >
          {t.viewport.zoomSelection}
        </MenuItem>
        <MenuSeparator />
        {PRESETS.map((preset) => (
          <MenuCheckboxItem
            key={preset}
            checked={sameZoom(zoom, preset)}
            shortcut={preset === 1 ? 'shift+0' : undefined}
            onSelect={() => zoomTo(preset)}
          >
            <span className="tabular-nums">{formatZoom(preset)}</span>
          </MenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
