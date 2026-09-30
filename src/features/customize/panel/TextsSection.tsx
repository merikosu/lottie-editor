import { TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { layerDisplayName } from '@/components/lottie/labels'
import { NumberField, Section, TextArea, Tooltip, type ChangeGesture } from '@/components/ui'
import { TruncatedText } from '@/features/io'
import { useT } from '@/i18n'
import { uid } from '@/lib/id'
import { throttle } from '@/lib/timing'
import { getAt, pathKey, type NodePath } from '@/lottie/path'
import {
  findFont,
  hasUniformText,
  listTextLayers,
  missingGlyphs,
  patchTextDocument,
  setTextContent,
  textKeyframes,
  textToEditor,
  usesGlyphs,
  type TextLayerRef,
  type TextScope,
} from '@/lottie/text'
import type { Animation, TextLayer } from '@/lottie/types'
import { selectNodes, updateDoc, useDocument } from '@/store/document'
import { retype, typingTemplate } from '../lib/typing'
import { setHoverNode } from '@/store/ui'

/** Text states listed per layer at most (texts that change during the animation). */
const MAX_STATES = 6

const gestureOptions = (g: ChangeGesture) => ({ coalesceKey: g.key, final: g.final })

function editText(
  label: string,
  path: NodePath,
  fn: (layer: TextLayer) => void,
  g: ChangeGesture,
): void {
  updateDoc(
    label,
    (draft) => {
      const layer = getAt<TextLayer>(draft, path)
      if (layer?.t) fn(layer)
    },
    gestureOptions(g),
  )
}

/**
 * Multi-line text field: it grows with its lines; typing is written to the document throttled,
 * and one focus session is one undo step.
 */
function TextField({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (text: string, gesture: ChangeGesture) => void
  label: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const session = useRef(uid('text'))
  const latest = useRef(onChange)
  const push = useRef<ReturnType<typeof throttle<[string, ChangeGesture]>> | null>(null)
  useEffect(() => {
    latest.current = onChange
  })
  useEffect(() => {
    const fn = throttle((text: string, g: ChangeGesture) => latest.current(text, g), 120)
    push.current = fn
    return () => fn.flush()
  }, [])
  const text = draft ?? value
  const rows = Math.min(6, Math.max(1, text.split('\n').length))
  return (
    <TextArea
      rows={rows}
      value={text}
      aria-label={label}
      spellCheck
      onFocus={() => {
        session.current = uid('text')
        setDraft(value)
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        push.current?.(e.target.value, { key: session.current, final: false })
      }}
      onBlur={() => {
        push.current?.flush()
        setDraft(null)
      }}
      className="min-h-6 resize-none py-1 leading-4"
      data-testid="customize-text"
    />
  )
}

function TextItem({ entry, doc }: { entry: TextLayerRef; doc: Animation }) {
  const t = useT()
  const { layer, path, compName } = entry
  const name = layerDisplayName(layer, path[path.length - 1] as number, t)
  const keyframes = textKeyframes(layer.t)
  // A text that types itself keeps typing while it is edited (even through short drafts):
  // its template is taken once, when the item appears.
  const [typing] = useState(() => typingTemplate(layer.t))
  const last = keyframes[keyframes.length - 1]
  // One field for a text that stays or types itself; one per state for texts that change.
  const states: { scope: TextScope | 'typed'; text: string; font?: string }[] =
    typing && last
      ? [{ scope: 'typed', text: last.s.t ?? '', font: keyframes[0]?.s.f }]
      : hasUniformText(layer.t)
        ? keyframes.slice(0, 1).map((k) => ({ scope: 'all', text: k.s.t ?? '', font: k.s.f }))
        : keyframes
            .slice(0, MAX_STATES)
            .map((k, i) => ({ scope: i, text: k.s.t ?? '', font: k.s.f }))
  const sizes = new Set(keyframes.map((k) => k.s.s))
  const size = sizes.size === 1 ? (keyframes[0]?.s.s ?? null) : null
  const glyphs = usesGlyphs(doc)
  if (!keyframes.length) return null

  return (
    <div
      className="flex flex-col gap-1"
      onPointerEnter={() => setHoverNode(path)}
      onPointerLeave={() => setHoverNode(null)}
    >
      <div className="flex h-6 min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => selectNodes([path])}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded-sm text-left text-xs text-fg-muted hover:text-fg"
        >
          <TruncatedText text={name} />
          {compName && (
            <span className="shrink truncate text-fg-subtle">
              {t.customize.texts.inComp(compName)}
            </span>
          )}
        </button>
        <Tooltip content={t.customize.texts.size}>
          <NumberField
            value={size}
            min={1}
            max={2000}
            step={1}
            precision={1}
            suffix="px"
            aria-label={t.customize.texts.size}
            className="w-[76px] shrink-0"
            onChange={(v, g) =>
              editText(
                t.customize.history.fontSize,
                path,
                (l) => patchTextDocument(l.t, { s: v }, 'all'),
                g,
              )
            }
          />
        </Tooltip>
      </div>
      {states.map((state, i) => {
        const missing = glyphs ? missingGlyphs(doc, state.text, findFont(doc, state.font)) : []
        return (
          // Single-field texts keep one field whatever their mode (focus survives edits).
          <div
            key={states.length > 1 ? `${pathKey(path)}#${i}` : pathKey(path)}
            className="flex flex-col gap-1"
          >
            {(states.length > 1 || state.scope === 'typed') && (
              <span className="text-2xs text-fg-subtle tabular-nums">
                {state.scope === 'typed'
                  ? t.customize.texts.typed
                  : t.customize.texts.state(i + 1, keyframes.length)}
              </span>
            )}
            <TextField
              value={textToEditor(state.text)}
              label={t.customize.texts.content(name)}
              onChange={(text, g) =>
                editText(
                  t.customize.history.text,
                  path,
                  (l) =>
                    state.scope === 'typed' && typing
                      ? retype(l.t, text, typing)
                      : setTextContent(l.t, text, state.scope === 'typed' ? 'all' : state.scope),
                  g,
                )
              }
            />
            {missing.length > 0 && (
              <span className="flex items-start gap-1.5 text-xs text-warning">
                <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                {t.customize.texts.missing(
                  missing.map((c) => (c === ' ' ? t.customize.texts.space : `“${c}”`)).join(', '),
                )}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Every text layer's content and font size, editable in place. */
export function TextsSection() {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const texts = useMemo(() => (doc ? listTextLayers(doc) : []), [doc])
  if (!doc) return null
  const glyphs = texts.length > 0 && usesGlyphs(doc)

  return (
    <Section
      id="customize.texts"
      title={
        <>
          {t.customize.texts.title}
          {texts.length > 0 && (
            <span className="ml-1.5 font-normal text-fg-subtle tabular-nums">{texts.length}</span>
          )}
        </>
      }
      contentClassName="gap-3"
    >
      {texts.length === 0 ? (
        <p className="text-xs text-fg-subtle">{t.customize.texts.empty}</p>
      ) : (
        <>
          {glyphs && (
            <p className="flex items-start gap-1.5 text-xs text-fg-muted">
              <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" />
              {t.customize.texts.glyphs}
            </p>
          )}
          {texts.map((entry) => (
            <TextItem key={pathKey(entry.path)} entry={entry} doc={doc} />
          ))}
        </>
      )}
    </Section>
  )
}
