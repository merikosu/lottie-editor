/**
 * Renderer switch (SVG / Canvas). The tooltip explains that canvas selection needs SVG.
 */
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  Tooltip,
} from '@/components/ui'
import { useT } from '@/i18n'
import { setPrefs, usePrefs, type RendererType } from '@/store/prefs'

const RENDERERS: readonly RendererType[] = ['svg', 'canvas']

export function RendererMenu() {
  const t = useT()
  const renderer = usePrefs((s) => s.renderer)
  const name = t.viewport.renderers[renderer]
  const tooltip =
    renderer === 'canvas' ? (
      <span className="block">
        {t.viewport.rendererTooltip(name)}
        <span className="mt-0.5 block text-fg-muted">{t.viewport.canvasNoSelection}</span>
      </span>
    ) : (
      t.viewport.rendererTooltip(name)
    )
  return (
    <DropdownMenu modal={false}>
      <Tooltip content={tooltip}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="renderer-menu"
            aria-label={t.viewport.rendererTooltip(name)}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md pr-1.5 pl-2 text-sm text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
          >
            {name}
            <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[264px]">
        <MenuLabel>{t.viewport.renderer}</MenuLabel>
        <MenuRadioGroup
          value={renderer}
          onValueChange={(v) => setPrefs({ renderer: v as RendererType })}
        >
          {RENDERERS.map((r) => (
            <MenuRadioItem key={r} value={r}>
              <span className="flex items-center justify-between gap-4">
                <span>{t.viewport.renderers[r]}</span>
                <span className="truncate text-xs text-fg-subtle group-data-[highlighted]:text-accent-fg/80">
                  {t.viewport.rendererHints[r]}
                </span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
