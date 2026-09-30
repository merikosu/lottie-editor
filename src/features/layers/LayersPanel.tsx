import { ChevronsDownUp, Layers, Plus, Search, SearchX, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  TextInput,
} from '@/components/ui'
import { useT } from '@/i18n'
import { selectNodes, useDocument } from '@/store/document'
import { AddMenuItems } from './LayerMenus'
import { LayerTree } from './LayerTree'
import { collapseAll, setFocusKey, setSearch, useLayersView } from './state'
import { createTreeBuilder, type TreeModel } from './tree-model'

function AddLayerMenu({
  children,
  align = 'end',
}: {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-w-80 min-w-[216px]">
        <AddMenuItems kind="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Toolbar({ model }: { model: TreeModel }) {
  const t = useT()
  const search = useLayersView((s) => s.search)
  const anyExpanded = useLayersView((s) => Object.keys(s.expanded).length > 0)
  const inputRef = useRef<HTMLInputElement>(null)

  /** Enter / ↓ in the search field: jump to the first match in the tree. */
  const goToFirstMatch = () => {
    const row = model.rows.find((r) => r.match) ?? model.rows[0]
    if (!row) return
    selectNodes([row.path])
    setFocusKey(row.key, true)
    document.querySelector<HTMLElement>('[data-testid="layer-tree"]')?.focus()
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-2">
      <TextInput
        ref={inputRef}
        icon={Search}
        value={search}
        placeholder={t.layers.searchPlaceholder}
        aria-label={t.layers.searchPlaceholder}
        data-testid="layer-search"
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (search) setSearch('')
            else inputRef.current?.blur()
          } else if ((e.key === 'Enter' || e.key === 'ArrowDown') && search) {
            e.preventDefault()
            goToFirstMatch()
          }
        }}
        containerClassName="min-w-0 flex-1"
        suffix={
          search ? (
            <span className="flex items-center gap-1">
              <span className="text-xs text-fg-subtle tabular-nums">{model.matches}</span>
              <button
                type="button"
                aria-label={t.layers.clearSearch}
                onClick={() => {
                  setSearch('')
                  inputRef.current?.focus()
                }}
                className="-mr-0.5 inline-flex size-4 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg"
              >
                <X size={12} />
              </button>
            </span>
          ) : null
        }
      />
      <AddLayerMenu>
        <IconButton icon={Plus} label={t.layers.addLayer} data-testid="layer-add" />
      </AddLayerMenu>
      <IconButton
        icon={ChevronsDownUp}
        label={t.layers.collapseAll}
        onClick={collapseAll}
        disabled={!anyExpanded}
      />
    </div>
  )
}

/** Left sidebar "Layers" tab. */
export function LayersPanel() {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const expanded = useLayersView((s) => s.expanded)
  const search = useLayersView((s) => s.search)
  const [build] = useState(createTreeBuilder)
  const model = useMemo(
    () => (doc ? build(doc, { expanded, search, t }) : null),
    [build, doc, expanded, search, t],
  )

  if (!doc || !model) return <EmptyState icon={Layers} title={t.common.noDocument} />

  const noLayers = !doc.layers?.length
  let body: ReactNode
  if (noLayers) {
    body = (
      <EmptyState
        icon={Layers}
        title={t.layers.empty.title}
        description={t.layers.empty.description}
        action={
          <AddLayerMenu align="center">
            <Button size="sm" icon={Plus}>
              {t.layers.addLayer}
            </Button>
          </AddLayerMenu>
        }
      />
    )
  } else if (model.searching && !model.rows.length) {
    body = (
      <EmptyState
        icon={SearchX}
        title={t.layers.noResults.title}
        description={t.layers.noResults.description(search.trim())}
      />
    )
  } else {
    body = <LayerTree model={model} doc={doc} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="layers-panel">
      <Toolbar model={model} />
      {body}
    </div>
  )
}
