/**
 * What is in the file before and after (layers, shapes, keyframes, images, number precision),
 * the animation's basic facts, re-encoded images and the engine's notes.
 */
import { Info } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { ContentCounts, ImageReport, OptimizeWarning } from '@/lottie/optimizer'
import { typicalDecimals } from '../../model/numbers'
import type { JobPart } from '../../model/types'
import { useFormat } from '../format'

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1 flex h-7 items-center px-1.5 text-xs font-semibold text-fg">{children}</h3>
  )
}

function CountRow({
  label,
  before,
  after,
  format,
}: {
  label: string
  before: number
  after: number
  format: (n: number) => string
}) {
  const changed = before !== after
  return (
    <div className="grid h-6 grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-x-2 px-1.5 text-xs">
      <span className="truncate text-fg-muted">{label}</span>
      <span className="text-right text-fg-subtle tabular-nums">{format(before)}</span>
      <span className={cn('text-right tabular-nums', changed ? 'text-fg' : 'text-fg-subtle')}>
        {format(after)}
      </span>
    </div>
  )
}

function Content({ part }: { part: JobPart }) {
  const t = useT()
  const f = useFormat()
  const report = part.result?.report
  const json = part.result?.json
  const decimals = useMemo(
    () => (json ? { before: typicalDecimals(part.source), after: typicalDecimals(json) } : null),
    [part.source, json],
  )
  if (!report) return null
  const R = t.optimizer.content.rows
  const b: ContentCounts = report.before.counts
  const a: ContentCounts = report.after.counts
  const n = (v: number) => f.number(v, 0)
  const rows: [string, number, number, (v: number) => string][] = [
    [R.layers, b.layers, a.layers, n],
    [R.shapes, b.shapes, a.shapes, n],
    [R.keyframes, b.keyframes, a.keyframes, n],
    [R.animated, b.animatedProperties, a.animatedProperties, n],
    [R.compositions, b.compositions, a.compositions, n],
    [R.numbers, b.numbers, a.numbers, n],
  ]
  if (decimals) rows.push([R.decimals, decimals.before, decimals.after, n])
  if (b.expressions || a.expressions) rows.push([R.expressions, b.expressions, a.expressions, n])
  if (b.images || a.images) {
    rows.push([R.images, b.images, a.images, n])
    rows.push([R.imageBytes, b.imageBytes, a.imageBytes, f.bytes])
  }
  return (
    <section>
      <div className="flex items-center justify-between pr-1.5">
        <SectionTitle>{t.optimizer.content.title}</SectionTitle>
        <span className="grid grid-cols-[72px_72px] gap-x-2 text-right text-2xs text-fg-faint">
          <span>{t.optimizer.content.before}</span>
          <span>{t.optimizer.content.after}</span>
        </span>
      </div>
      {rows.map(([label, before, after, format]) => (
        <CountRow key={label} label={label} before={before} after={after} format={format} />
      ))}
    </section>
  )
}

function Facts({ part, version }: { part: JobPart; version?: string }) {
  const t = useT()
  const f = useFormat()
  const { width, height, fps, ip, op } = part.info
  const facts: [string, string][] = [
    [t.optimizer.content.size, `${f.int(width)} × ${f.int(height)}`],
    [t.optimizer.content.frameRate, `${f.number(fps)} ${t.common.fps}`],
    [
      t.optimizer.content.duration,
      `${f.number(fps > 0 ? (op - ip) / fps : 0)} ${t.common.secondsShort} · ${f.number(op - ip)} ${t.common.frames}`,
    ],
  ]
  if (version) facts.push([t.optimizer.content.version, version])
  return (
    <section>
      <SectionTitle>{t.optimizer.content.animation}</SectionTitle>
      {facts.map(([label, value]) => (
        <div
          key={label}
          className="grid h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-1.5 text-xs"
        >
          <span className="truncate text-fg-muted">{label}</span>
          <span className="text-right text-fg tabular-nums">{value}</span>
        </div>
      ))}
    </section>
  )
}

const kind = (mime: string) => mime.replace(/^image\//, '').toUpperCase()
const dims = (s: ImageReport['before']) => (s.width && s.height ? ` · ${s.width}×${s.height}` : '')

function Images({ images }: { images: ImageReport[] }) {
  const t = useT()
  const f = useFormat()
  if (!images.length) return null
  return (
    <section>
      <SectionTitle>{t.optimizer.content.imagesTitle}</SectionTitle>
      {images.map((img) => (
        <div key={img.id} className="flex flex-col gap-0.5 px-1.5 py-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-2xs text-fg-muted">{img.id}</span>
            <span className="shrink-0 text-2xs text-fg-subtle">
              {t.optimizer.content.imageActions[img.action]}
            </span>
          </div>
          <div className="truncate text-fg-subtle tabular-nums">
            {kind(img.before.mime)}
            {dims(img.before)} · {f.bytes(img.before.bytes)}
            <span className="px-1 text-fg-faint">→</span>
            <span className="text-fg">
              {kind(img.after.mime)}
              {dims(img.after)} · {f.bytes(img.after.bytes)}
            </span>
          </div>
        </div>
      ))}
    </section>
  )
}

function Notes({ warnings }: { warnings: OptimizeWarning[] }) {
  const t = useT()
  const W = t.optimizer.warnings
  const text = (w: OptimizeWarning): string => {
    const v = W[w.code]
    return typeof v === 'function' ? v(w.count ?? 1) : v
  }
  return (
    <section>
      <SectionTitle>{t.optimizer.content.warnings}</SectionTitle>
      {warnings.length ? (
        <ul className="flex flex-col gap-1.5 px-1.5">
          {warnings.map((w) => (
            <li key={w.code} className="flex gap-2 text-xs text-fg-muted" data-warning={w.code}>
              <Info size={14} className="mt-px shrink-0 text-fg-subtle" />
              <span>{text(w)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1.5 text-xs text-fg-subtle">{t.optimizer.content.noWarnings}</p>
      )}
    </section>
  )
}

export function DetailsTab({ part, version }: { part: JobPart | undefined; version?: string }) {
  if (!part) return null
  const report = part.result?.report
  return (
    <div className="flex flex-col gap-4 px-3 pt-3 pb-4" data-testid="opt-details">
      <Content part={part} />
      <Facts part={part} version={version} />
      {report && <Images images={report.images} />}
      {report && <Notes warnings={report.warnings} />}
    </div>
  )
}
