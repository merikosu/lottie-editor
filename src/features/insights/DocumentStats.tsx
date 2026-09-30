import { Gauge } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton, Section, Tooltip } from '@/components/ui'
import { useLanguage, useT } from '@/i18n'
import { emit } from '@/lib/events'
import { formatBytes } from '@/lib/format'
import { getAt, type NodePath } from '@/lottie/path'
import type { DocumentStatistics, StatFeature } from '@/lottie/stats'
import { durationSeconds, frameCount } from '@/lottie/time'
import { getDoc, selectNodes, useDocument } from '@/store/document'
import { openOptimizer } from './actions'
import { useAnalysisSubscription } from './engine'
import { formatCount } from './format'
import { useAnalysis } from './store'

/**
 * Statistics section of the inspector's document view: what the animation is made of, its size
 * raw and gzipped, and the notable features it uses (click a feature to select its layers).
 */
export function DocumentStats() {
  const t = useT()
  const lang = useLanguage()
  useAnalysisSubscription()
  const result = useAnalysis((s) => s.result)
  // Live values (retiming shows at once); damaged files may hold anything here.
  const fps = useDocument((s) => finite(s.doc?.fr))
  const frames = useDocument((s) => (s.doc ? finite(frameCount(s.doc)) : 0))
  const seconds = useDocument((s) => (s.doc ? finite(durationSeconds(s.doc)) : 0))
  const st = t.insights.stats
  const stats = result?.stats ?? null
  const size = result?.size ?? null
  const n = (value: number | undefined) => (value === undefined ? '—' : formatCount(value, lang, 0))
  const durationHint = st.durationHint(frames, formatCount(fps, lang))

  return (
    <Section
      id="inspector.document.stats"
      title={st.title}
      actions={
        <IconButton icon={Gauge} label={st.optimize} onClick={openOptimizer} tooltipSide="left" />
      }
    >
      <div className="grid grid-cols-2 gap-x-4" data-testid="document-stats">
        <Stat
          label={st.layers}
          value={n(stats?.layers)}
          hint={stats ? layersHint(stats, t) : undefined}
        />
        <Stat
          label={st.shapes}
          value={n(stats?.shapes)}
          hint={stats ? st.shapesHint(stats.groups) : undefined}
        />
        <Stat
          label={st.keyframes}
          value={n(stats?.keyframes)}
          hint={stats ? st.keyframesHint(stats.animatedProperties) : undefined}
        />
        <Stat
          label={st.animated}
          value={n(stats?.animatedProperties)}
          hint={stats ? st.animatedHint(stats.properties) : undefined}
        />
        <Stat
          label={st.precomps}
          value={n(stats?.compositions)}
          hint={stats ? st.precompsHint(stats.precompLayers) : undefined}
        />
        <Stat
          label={st.images}
          value={n(stats?.imageAssets)}
          hint={
            stats && stats.imageAssets > 0
              ? `${st.imagesHint(stats.embeddedImages, stats.externalImages)}${stats.imageBytes ? ` · ${formatBytes(stats.imageBytes)}` : ''}`
              : undefined
          }
        />
        <Stat label={st.size} value={size ? formatBytes(size.raw) : '—'} hint={st.sizeHint} />
        <Stat label={st.gzip} value={size ? formatBytes(size.gzip) : '—'} hint={st.gzipHint} />
        <Stat
          label={st.duration}
          value={`${formatCount(seconds, lang)} ${t.common.secondsShort}`}
          hint={durationHint}
        />
        <Stat label={st.frames} value={formatCount(frames, lang, 0)} hint={durationHint} />
      </div>
      {stats && stats.features.length > 0 && <Features features={stats.features} />}
    </Section>
  )
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function layersHint(stats: DocumentStatistics, t: ReturnType<typeof useT>): string {
  const kinds = Object.entries(stats.layersByKind)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(
      ([kind, count]) =>
        `${t.common.layerKinds[kind as keyof typeof t.common.layerKinds]} ${count}`,
    )
  if (stats.hiddenLayers) kinds.push(t.insights.stats.hidden(stats.hiddenLayers))
  return t.insights.stats.layersHint(kinds.join(' · '))
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  const cell = (
    <div className="flex h-6 min-w-0 items-center justify-between gap-2">
      <span className="min-w-0 truncate text-xs text-fg-muted">{label}</span>
      <span className="selectable shrink-0 text-sm text-fg tabular-nums">{value}</span>
    </div>
  )
  return hint ? (
    <Tooltip content={hint} side="left">
      {cell}
    </Tooltip>
  ) : (
    cell
  )
}

/** Selects the layers of a feature that still exist (the statistics may be a moment old). */
function selectLayers(paths: readonly NodePath[]): void {
  const doc = getDoc()
  if (!doc) return
  const existing = paths.filter((p) => {
    const node = getAt(doc, p)
    return node !== null && typeof node === 'object'
  })
  if (!existing.length) return
  selectNodes(existing)
  emit('reveal-node', { path: existing[existing.length - 1] })
}

function Features({ features }: { features: StatFeature[] }) {
  const t = useT()
  const lang = useLanguage()
  const st = t.insights.stats
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="text-xs text-fg-muted">{st.features}</div>
      <div className="flex flex-wrap gap-1" data-testid="document-features">
        {features.map((f) => (
          <Tooltip
            key={f.id}
            content={`${st.chipHints[f.id](f.count)} · ${st.selectLayers(f.layers.length)}`}
            side="bottom"
          >
            <button
              type="button"
              onClick={() => selectLayers(f.layers)}
              className="inline-flex h-5 items-center gap-1 rounded-sm bg-surface-2 px-1.5 text-xs text-fg-muted transition-colors hover:bg-pressed hover:text-fg"
            >
              {st.chips[f.id]}
              <span className="text-fg-subtle tabular-nums">{formatCount(f.count, lang, 0)}</span>
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
