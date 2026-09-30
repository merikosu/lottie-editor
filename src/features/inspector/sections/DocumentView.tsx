/**
 * Inspector content when nothing is selected: the animation itself (name, size, timing,
 * colors, text of every text layer, markers, statistics).
 */
import { Flag } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { FieldRow, Section, TextInput, Tooltip } from '@/components/ui'
import { layerDisplayName } from '@/components/lottie/labels'
import { DocumentColorsSection } from '@/features/colors'
import { DocumentSizeSection, DocumentTimingSection } from '@/features/docops'
import { DocumentStats } from '@/features/insights'
import { ThemesSection } from '@/features/themes'
import { useT } from '@/i18n'
import { formatTimecode } from '@/lib/format'
import { roundTo } from '@/lib/math'
import { getAt, pathKey } from '@/lottie/path'
import {
  listTextLayers,
  setTextContent,
  textKeyframeIndexAt,
  hasUniformText,
  textKeyframes,
  textToEditor,
} from '@/lottie/text'
import type { Marker, TextLayer } from '@/lottie/types'
import { selectNodes, updateDoc, useDocument } from '@/store/document'
import { setFrame } from '@/store/playback'
import { CountTitle, Note } from '../components/Row'
import { TextContentField } from '../components/TextContentField'
import { gestureOptions } from '../edit'
import { useInspectorFrame } from '../hooks'
import { compTimeFor } from '../model/time'

export function DocumentView() {
  return (
    <>
      <AnimationSection />
      <Foreign name="document-size">
        <DocumentSizeSection />
      </Foreign>
      <Foreign name="document-timing">
        <DocumentTimingSection />
      </Foreign>
      <Foreign name="document-colors">
        <DocumentColorsSection />
      </Foreign>
      <Foreign name="document-themes">
        <ThemesSection />
      </Foreign>
      <TextLayersSection />
      <MarkersSection />
      <Foreign name="document-stats">
        <DocumentStats />
      </Foreign>
    </>
  )
}

/** Sections owned by other features: a crash there must not take the inspector down. */
function Foreign({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary name={name} compact>
      {children}
    </ErrorBoundary>
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Animation                                 */
/* -------------------------------------------------------------------------- */

function AnimationSection() {
  const t = useT()
  const td = t.inspector.document
  const name = useDocument((s) => s.doc?.nm ?? '')
  const version = useDocument((s) => s.doc?.v)
  const meta = useDocument((s) => s.doc?.meta)
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (next === name) return
    updateDoc(t.inspector.history.renameAnimation, (d) => {
      if (next) d.nm = next
      else delete d.nm
    })
  }

  const facts = [
    version ? td.bodymovin(version) : null,
    meta?.g ? td.generator(meta.g) : null,
    meta?.a ? td.author(meta.a) : null,
  ].filter(Boolean)

  return (
    <Section id="inspector.document.animation" title={t.common.animation}>
      <FieldRow label={td.name}>
        <TextInput
          value={draft ?? name}
          placeholder={td.namePlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(null)
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
            }
          }}
          containerClassName="w-full"
          aria-label={td.name}
        />
      </FieldRow>
      {facts.length > 0 && (
        <div className="selectable pl-[92px] text-xs text-fg-subtle">
          {facts.map((f, i) => (
            <span key={i} className="block truncate" title={f ?? undefined}>
              {f}
            </span>
          ))}
        </div>
      )}
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Text                                    */
/* -------------------------------------------------------------------------- */

/** Every text layer's content, editable in place: quick text replacement. */
function TextLayersSection() {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const frame = useInspectorFrame()
  const layers = useMemo(() => (doc ? listTextLayers(doc) : []), [doc])
  if (!doc || layers.length === 0) return null

  return (
    <Section id="inspector.document.text" title={t.inspector.document.text}>
      {layers.map(({ layer, path, compName }) => {
        const index = path[path.length - 1] as number
        const time = compTimeFor(doc, path, frame)
        // Uniform text edits every keyframe; animated source text edits the one on screen.
        const scope = hasUniformText(layer.t)
          ? 'all'
          : Math.max(0, textKeyframeIndexAt(layer.t, time.frame))
        const keyframes = textKeyframes(layer.t)
        const current = scope === 'all' ? keyframes[0] : keyframes[scope]
        if (!current) return null
        const key = pathKey(path)
        return (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex h-5 min-w-0 items-baseline gap-1.5">
              <button
                type="button"
                onClick={() => selectNodes([path])}
                className="flex min-w-0 items-baseline gap-1.5 rounded-sm text-left text-xs text-fg-muted hover:text-fg"
              >
                <span className="truncate">{layerDisplayName(layer, index, t)}</span>
                {compName && (
                  <span className="truncate text-fg-subtle">
                    {t.inspector.document.textIn(compName)}
                  </span>
                )}
              </button>
              {scope !== 'all' && (
                <span className="ml-auto shrink-0 text-xs text-fg-subtle tabular-nums">
                  {t.inspector.document.textKeyAt(scope + 1, keyframes.length)}
                </span>
              )}
            </div>
            <TextContentField
              key={`${key}#${scope}`}
              value={textToEditor(current.s.t)}
              maxRows={6}
              onChange={(text, gesture) =>
                updateDoc(
                  t.inspector.history.editText,
                  (draft) => {
                    const l = getAt<TextLayer>(draft, path)
                    if (l?.t) setTextContent(l.t, text, scope)
                  },
                  gestureOptions(gesture),
                )
              }
            />
          </div>
        )
      })}
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Markers                                  */
/* -------------------------------------------------------------------------- */

function MarkersSection() {
  const t = useT()
  const td = t.inspector.document
  const markers = useDocument((s) => s.doc?.markers)
  const fps = useDocument((s) => s.doc?.fr ?? 30)
  const playhead = useInspectorFrame()
  const list = Array.isArray(markers) ? [...markers].sort((a, b) => a.tm - b.tm) : []

  return (
    <Section
      id="inspector.document.markers"
      title={<CountTitle title={td.markers} count={list.length} />}
    >
      {list.length === 0 ? (
        <Note>
          {td.noMarkers} {td.addMarkerHint}
        </Note>
      ) : (
        <div className="-mx-1.5 flex flex-col">
          {list.map((m, i) => (
            <MarkerRow
              key={`${m.tm}-${i}`}
              marker={m}
              fps={fps}
              active={Math.round(m.tm) === playhead}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

function markerName(marker: Marker): string {
  // Some exporters store JSON payloads in `cm` ({"name": "..."}): show the name.
  const cm = typeof marker.cm === 'string' ? marker.cm : String(marker.cm ?? '')
  if (cm.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(cm) as { name?: unknown }
      if (typeof parsed.name === 'string') return parsed.name
    } catch {
      /* plain comment */
    }
  }
  return cm
}

function MarkerRow({ marker, fps, active }: { marker: Marker; fps: number; active: boolean }) {
  const t = useT()
  const name = markerName(marker)
  const f = t.common.framesShort
  const start = roundTo(marker.tm, 2)
  const end = roundTo(marker.tm + marker.dr, 2)
  const range = marker.dr > 0 ? `${start}–${end} ${f}` : `${start} ${f}`
  const time =
    marker.dr > 0
      ? `${formatTimecode(marker.tm, fps)} – ${formatTimecode(marker.tm + marker.dr, fps)}`
      : formatTimecode(marker.tm, fps)
  return (
    <Tooltip content={`${t.inspector.document.goToMarker} · ${time}`} side="left">
      <button
        type="button"
        onClick={() => setFrame(marker.tm)}
        className="group/marker flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left hover:bg-hover"
      >
        <Flag
          size={12}
          className={
            active
              ? 'shrink-0 text-accent-text'
              : 'shrink-0 text-fg-subtle group-hover/marker:text-fg-muted'
          }
        />
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{name || '—'}</span>
        <span className="shrink-0 text-xs text-fg-subtle tabular-nums">{range}</span>
      </button>
    </Tooltip>
  )
}
