import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import { Badge, Dialog, EmptyState, TextInput } from '@/components/ui'
import { useLanguage, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { animationName } from '@/lottie/formats'
import type { Animation } from '@/lottie/types'
import { useDocument } from '@/store/document'
import type { PickerProps } from '../dialog-ids'
import { LottiePreview } from '../LottiePreview'
import { loadOpened, switchAnimation } from '../open'
import { containerOf } from '../source'
import { formatDuration } from '../format'
import { TruncatedText } from '../TruncatedText'

interface Item {
  id: string
  /** Main label: the animation name, or its id when several animations share a name ("Comp 1"). */
  title: string
  /** The id under a unique name, when it says something the name does not. */
  subtitle: string | null
  data: Animation
  badge: 'initial' | 'current' | null
}

type RawItem = Omit<Item, 'title' | 'subtitle'> & { name: string }

/** "Comp 1", "comp_1" and "comp-1" say the same thing. */
const sameLabel = (a: string, b: string) =>
  a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') ===
  b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

function withLabels(raw: RawItem[]): Item[] {
  const counts = new Map<string, number>()
  for (const r of raw) counts.set(r.name, (counts.get(r.name) ?? 0) + 1)
  return raw.map(({ name, ...r }) => {
    // A name shared by several animations ("Comp 1" everywhere) tells them apart by id only.
    if ((counts.get(name) ?? 0) > 1) return { ...r, title: r.id, subtitle: null }
    return { ...r, title: name, subtitle: sameLabel(r.id, name) ? null : r.id }
  })
}

const FILTER_FROM = 9

function useItems(props: PickerProps): Item[] {
  const doc = useDocument((s) => s.doc)
  const meta = useDocument((s) => s.meta)
  return useMemo(() => {
    if (props.mode === 'open') {
      const { result } = props
      return withLabels(
        result.animations.map((a) => ({
          id: a.id,
          name: a.name,
          data: a.data,
          badge:
            result.kind === 'dotlottie' && a.id === result.activeId ? ('initial' as const) : null,
        })),
      )
    }
    const container = containerOf(meta?.dotLottie)
    if (!container || !doc) return []
    return withLabels(
      container.animations.flatMap((a): RawItem[] => {
        const data = a.id === container.activeId ? doc : a.data
        if (!data) return []
        const name =
          typeof a.meta.name === 'string' && a.meta.name
            ? a.meta.name
            : animationName(data.nm) || a.id
        return [{ id: a.id, name, data, badge: a.id === container.activeId ? 'current' : null }]
      }),
    )
  }, [props, doc, meta])
}

/** Chooses one animation of a file that holds several (dotLottie, ZIP or a JSON list). */
export function PickerDialog({ props, close }: DialogComponentProps<PickerProps>) {
  const t = useT()
  const language = useLanguage()
  const items = useItems(props)
  const fileName = useDocument((s) => s.meta?.fileName ?? '')
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const shown = q
    ? items.filter(
        (i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q),
      )
    : items

  const title = props.mode === 'open' ? t.io.picker.title : t.io.picker.switchTitle
  const description =
    props.mode === 'switch'
      ? t.io.picker.switchDescription
      : props.result.kind === 'dotlottie'
        ? t.io.picker.description(props.result.fileName, items.length)
        : props.info.source === 'paste'
          ? t.io.picker.descriptionPaste(items.length)
          : t.io.picker.descriptionList(props.result.fileName || fileName, items.length)

  const pick = (id: string) => {
    close()
    if (props.mode === 'open') loadOpened(props.result, id, props.info)
    else switchAnimation(id)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      size="lg"
      title={title}
      description={description}
      bodyClassName="pt-1"
    >
      {items.length >= FILTER_FROM && (
        <TextInput
          icon={Search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.io.picker.search}
          aria-label={t.io.picker.search}
          containerClassName="mb-3"
          autoFocus
        />
      )}
      {shown.length === 0 ? (
        <EmptyState icon={Search} title={t.io.picker.noMatches} className="min-h-40" />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          {shown.map((item, index) => {
            const frames = Math.max(0, item.data.op - item.data.ip)
            const duration = `${formatDuration(frames, item.data.fr, language)} ${t.common.secondsShort}`
            return (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  data-testid="picker-item"
                  // Focus the first choice rather than the dialog's close button.
                  autoFocus={index === 0 && items.length < FILTER_FROM}
                  disabled={item.badge === 'current'}
                  onClick={() => pick(item.id)}
                  onPointerEnter={() => setHovered(item.id)}
                  onPointerLeave={() => setHovered((h) => (h === item.id ? null : h))}
                  onFocus={(e) => e.currentTarget.matches(':focus-visible') && setHovered(item.id)}
                  onBlur={() => setHovered((h) => (h === item.id ? null : h))}
                  className={cn(
                    'flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface-1 text-left',
                    // A real border: an inset shadow would be painted over by the preview.
                    'border border-line transition-colors duration-100',
                    'hover:border-line-strong disabled:border-accent',
                  )}
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-surface-2">
                    <LottiePreview
                      source={item.data}
                      playing={hovered === item.id}
                      className="absolute inset-[8%]"
                    />
                    {item.badge && (
                      <Badge
                        tone={item.badge === 'current' ? 'accent' : 'neutral'}
                        className="absolute top-1.5 left-1.5"
                      >
                        {item.badge === 'current' ? t.io.picker.current : t.io.picker.initial}
                      </Badge>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5 px-2 pt-1.5 pb-2">
                    <TruncatedText text={item.title} className="text-sm font-medium text-fg" />
                    <span className="truncate text-xs text-fg-subtle tabular-nums">
                      {item.data.w} × {item.data.h} · {item.data.fr} {t.common.fps} · {duration}
                    </span>
                    {item.subtitle && (
                      <TruncatedText text={item.subtitle} className="text-xs text-fg-subtle" />
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
