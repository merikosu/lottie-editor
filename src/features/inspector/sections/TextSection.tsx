/**
 * Text layer: content (live, one undo step per editing session), font, size, colors,
 * alignment, tracking, line height; warnings for glyph-based text and unavailable fonts.
 */
import { AlignCenter, AlignLeft, AlignRight, Minus, Plus, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Button,
  ColorField,
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Section,
  SegmentedControl,
  Select,
  TextInput,
  type ChangeGesture,
  type SelectOption,
} from '@/components/ui'
import { NumberField } from '../components/number-field'
import { useDocumentColors } from '@/features/colors'
import { useT } from '@/i18n'
import { lottieToRgba } from '@/lib/color'
import { getAt, pathKey, type NodePath } from '@/lottie/path'
import { evaluateTextDocument } from '@/lottie/property'
import {
  addFont,
  findFont,
  fontFamilyFor,
  fontLabel,
  fontStack,
  hasUniformText,
  listFonts,
  missingGlyphs,
  patchTextDocument,
  setTextContent,
  textKeyframeIndexAt,
  textKeyframes,
  textToEditor,
  usesGlyphs,
  TextJustify,
  type TextScope,
} from '@/lottie/text'
import type { Animation, TextDocument, TextLayer } from '@/lottie/types'
import { updateDoc, useDocument } from '@/store/document'
import { NumberRow } from '../components/plain'
import { gestureOptions } from '../edit'
import { encodeColor } from '../model/values'
import { InspectorRow, Note } from '../components/Row'
import { useFontAvailable } from '../hooks'
import type { CompTime } from '../model/time'
import { IconSegmented } from '../components/IconSegmented'
import { TextContentField } from '../components/TextContentField'

type Justify = 'left' | 'center' | 'right'

const justifyOf = (j: number | undefined): Justify =>
  j === TextJustify.Center ? 'center' : j === TextJustify.Right ? 'right' : 'left'

const JUSTIFY_VALUE: Record<Justify, number> = {
  left: TextJustify.Left,
  center: TextJustify.Center,
  right: TextJustify.Right,
}

const ADD_FONT = '__add_font__'

export function TextSection({
  path,
  layer,
  time,
}: {
  path: NodePath
  layer: TextLayer
  time: CompTime
}) {
  const t = useT()
  const tt = t.inspector.text
  const swatches = useDocumentColors()
  const fonts = useDocument((s) => s.doc?.fonts)
  const chars = useDocument((s) => s.doc?.chars)

  const keyframes = textKeyframes(layer.t)
  const multiple = keyframes.length > 1
  const [scopeChoice, setScopeChoice] = useState<'all' | 'current' | null>(null)
  const scopeMode = scopeChoice ?? (hasUniformText(layer.t) ? 'all' : 'current')
  const currentIndex = Math.max(0, textKeyframeIndexAt(layer.t, time.frame))
  const scope: TextScope = multiple && scopeMode === 'current' ? currentIndex : 'all'
  const doc = evaluateTextDocument(layer.t, time.frame) ?? keyframes[0]?.s ?? null

  const docFonts = useMemo(() => listFonts({ fonts } as Animation), [fonts])
  const font = doc ? findFont({ fonts } as Animation, doc.f) : undefined
  const family = doc ? fontFamilyFor({ fonts } as Animation, doc.f) : undefined
  const glyphs = usesGlyphs({ chars } as Animation)
  const fontAvailable = useFontAvailable(glyphs ? undefined : family)
  const missing = glyphs && doc ? missingGlyphs({ chars } as Animation, doc.t ?? '', font) : []

  if (!doc) return null

  const edit = (label: string, fn: (layer: TextLayer) => void, gesture?: ChangeGesture) =>
    updateDoc(
      label,
      (draft) => {
        const l = getAt<TextLayer>(draft, path)
        if (l?.t) fn(l)
      },
      gestureOptions(gesture),
    )

  const style = (patch: Partial<TextDocument>, gesture?: ChangeGesture) =>
    edit(t.inspector.history.textStyle, (l) => patchTextDocument(l.t, patch, scope), gesture)

  const fontOptions: SelectOption<string>[] = docFonts.map((f) => ({
    value: f.fName,
    label: fontLabel(f),
  }))
  if (doc.f && !docFonts.some((f) => f.fName === doc.f))
    fontOptions.unshift({ value: doc.f, label: doc.f, disabled: true })

  const fill = doc.fc ? lottieToRgba(doc.fc) : null
  const stroke = doc.sc ? lottieToRgba(doc.sc) : null

  return (
    <Section id="inspector.text" title={t.inspector.sections.text}>
      {multiple && (
        <>
          <Note className="pl-5">{tt.animatedText(keyframes.length)}</Note>
          <InspectorRow label={tt.scope}>
            <SegmentedControl<'all' | 'current'>
              value={scopeMode}
              onValueChange={setScopeChoice}
              options={[
                { value: 'all', label: tt.scopeAll },
                { value: 'current', label: tt.scopeCurrent },
              ]}
              fill
              className="w-full"
              aria-label={tt.scope}
            />
          </InspectorRow>
        </>
      )}
      <InspectorRow label={tt.content} alignTop>
        <TextContentField
          key={`${pathKey(path)}#${scope}`}
          focusKey={pathKey(path)}
          value={textToEditor(doc.t)}
          onChange={(text, gesture) =>
            edit(t.inspector.history.editText, (l) => setTextContent(l.t, text, scope), gesture)
          }
        />
      </InspectorRow>
      {glyphs && (
        <Note tone="warning" icon={<TriangleAlert size={12} />} className="pl-5">
          {tt.glyphs}
          {missing.length > 0 && (
            <span className="mt-0.5 block text-fg">
              {tt.missingGlyphs(missing.map((c) => (c === ' ' ? tt.space : `“${c}”`)).join(', '))}
            </span>
          )}
        </Note>
      )}
      <FontRow
        value={doc.f}
        options={fontOptions}
        onChange={(fName) => style({ f: fName })}
        onAdd={(familyName, fontStyle) => {
          updateDoc(t.inspector.history.addFont, (draft) => {
            const fName = addFont(draft as Animation, { family: familyName, style: fontStyle })
            const l = getAt<TextLayer>(draft, path)
            if (l?.t) patchTextDocument(l.t, { f: fName }, scope)
          })
        }}
      />
      {!glyphs && !fontAvailable && family && (
        <Note tone="warning" icon={<TriangleAlert size={12} />} className="pl-5">
          {tt.fontMissing(fontStack(family)[0] ?? family)}
        </Note>
      )}
      {!glyphs && doc.f && docFonts.length > 0 && !font && (
        <Note tone="warning" icon={<TriangleAlert size={12} />} className="pl-5">
          {tt.fontUnknown(doc.f)}
        </Note>
      )}
      <NumberRow
        label={tt.fontSize}
        value={doc.s ?? null}
        unit="px"
        precision={1}
        min={1}
        onChange={(v, g) => style({ s: v }, g)}
      />
      <InspectorRow label={tt.fill}>
        {fill ? (
          <div className="flex w-full min-w-0 items-center gap-1.5">
            <ColorField
              className="min-w-0 flex-1"
              value={{ ...fill, a: 1 }}
              alpha={false}
              swatches={swatches}
              onChange={(c, g) => style({ fc: encodeColor(c, 1, 3) }, g)}
            />
            <IconButton
              icon={Minus}
              label={tt.removeFill}
              onClick={() => style({ fc: undefined })}
              tooltipSide="left"
            />
          </div>
        ) : (
          <AddColorButton label={tt.addFill} onClick={() => style({ fc: [0, 0, 0] })} />
        )}
      </InspectorRow>
      <InspectorRow label={tt.stroke}>
        {stroke ? (
          <div className="flex w-full min-w-0 items-center gap-1.5">
            <ColorField
              className="min-w-0 flex-1"
              value={{ ...stroke, a: 1 }}
              alpha={false}
              swatches={swatches}
              onChange={(c, g) => style({ sc: encodeColor(c, 1, 3) }, g)}
            />
            <NumberField
              className="w-14 shrink-0"
              value={doc.sw ?? 0}
              min={0}
              precision={1}
              suffix="px"
              aria-label={tt.strokeWidth}
              labelTooltip={tt.strokeWidth}
              onChange={(v, g) => style({ sw: v }, g)}
            />
            <IconButton
              icon={Minus}
              label={tt.removeStroke}
              onClick={() => style({ sc: undefined, sw: undefined, of: undefined })}
              tooltipSide="left"
            />
          </div>
        ) : (
          <AddColorButton
            label={tt.addStroke}
            onClick={() =>
              style({ sc: [0, 0, 0], sw: Math.max(1, Math.round((doc.s ?? 24) / 24)) })
            }
          />
        )}
      </InspectorRow>
      <InspectorRow label={tt.justify}>
        <IconSegmented<Justify>
          value={justifyOf(doc.j)}
          onChange={(j) => style({ j: JUSTIFY_VALUE[j] })}
          options={[
            { value: 'left', icon: AlignLeft, title: tt.alignLeft },
            { value: 'center', icon: AlignCenter, title: tt.alignCenter },
            { value: 'right', icon: AlignRight, title: tt.alignRight },
          ]}
          label={tt.justify}
        />
      </InspectorRow>
      <NumberRow
        label={tt.tracking}
        value={doc.tr ?? 0}
        precision={0}
        onChange={(v, g) => style({ tr: v }, g)}
      />
      <NumberRow
        label={tt.lineHeight}
        value={doc.lh ?? null}
        unit="px"
        precision={1}
        min={0}
        onChange={(v, g) => style({ lh: v }, g)}
      />
      {doc.ls !== undefined && doc.ls !== 0 && (
        <NumberRow
          label={tt.baselineShift}
          value={doc.ls}
          unit="px"
          precision={1}
          onChange={(v, g) => style({ ls: v }, g)}
        />
      )}
    </Section>
  )
}

function AddColorButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Plus}
      className="-ml-2 text-fg-subtle"
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Fonts                                   */
/* -------------------------------------------------------------------------- */

function FontRow({
  value,
  options,
  onChange,
  onAdd,
}: {
  value: string
  options: SelectOption<string>[]
  onChange: (fName: string) => void
  onAdd: (family: string, style: string) => void
}) {
  const t = useT()
  const tt = t.inspector.text
  const [adding, setAdding] = useState(false)
  const [family, setFamily] = useState('')
  const [fontStyle, setFontStyle] = useState('Regular')

  const submit = () => {
    if (!family.trim()) return
    onAdd(family.trim(), fontStyle.trim() || 'Regular')
    setAdding(false)
    setFamily('')
    setFontStyle('Regular')
  }

  return (
    <Popover open={adding} onOpenChange={setAdding}>
      <PopoverAnchor asChild>
        <div>
          <InspectorRow label={tt.font}>
            <Select<string>
              value={value || undefined}
              // Open after the select has closed and returned focus to its trigger; otherwise
              // that focus change dismisses the popover right away.
              onValueChange={(v) =>
                v === ADD_FONT ? setTimeout(() => setAdding(true), 60) : onChange(v)
              }
              options={[...options, { value: ADD_FONT, label: tt.addFont, icon: Plus }]}
              aria-label={tt.font}
            />
          </InspectorRow>
        </div>
      </PopoverAnchor>
      <PopoverContent side="left" align="start" sideOffset={12} className="w-60">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="text-sm font-medium text-fg">{tt.addFontTitle}</div>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {tt.fontFamily}
            <TextInput
              autoFocus
              value={family}
              placeholder={tt.fontFamilyPlaceholder}
              onChange={(e) => setFamily(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {tt.fontStyle}
            <TextInput
              value={fontStyle}
              placeholder={tt.fontStylePlaceholder}
              onChange={(e) => setFontStyle(e.target.value)}
            />
          </label>
          <div className="mt-1 flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={!family.trim()}>
              {t.common.add}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
