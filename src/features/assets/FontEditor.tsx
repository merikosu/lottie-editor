import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, PopoverContent, TextInput } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { fontNameFor, uniqueFontName } from '@/lottie/assets'
import type { Font } from '@/lottie/types'
import { getDoc } from '@/store/document'
import { addFontEntry, updateFontEntry } from './actions'
import { isFontStackAvailable } from './font-availability'
import { editFont } from './store'

const STYLES = ['Regular', 'Italic', 'Light', 'Medium', 'SemiBold', 'Bold', 'Bold Italic', 'Black']
/** Suggestions still work; Chrome's dropdown arrow on inputs with a datalist looks foreign here. */
const HIDE_LIST_ARROW = '[&::-webkit-calendar-picker-indicator]:hidden!'
/** Suggestions next to the families the document already uses. */
const COMMON_FAMILIES = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Lato',
  'Poppins',
  'Helvetica',
  'Arial',
  'Georgia',
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-xs text-fg-muted">{label}</span>
      {children}
    </label>
  )
}

/**
 * Popover form to add a font entry (`font` omitted) or edit one. The family drives the
 * preview: when it is installed locally, text layers render with it right away.
 */
export function FontEditor({ font }: { font?: Font }) {
  const t = useT()
  const [family, setFamily] = useState(font?.fFamily ?? '')
  const [style, setStyle] = useState(font?.fStyle ?? 'Regular')
  const trimmed = family.trim()
  // Families are often CSS stacks ("Inter Variable, Inter, sans-serif"), like the list row checks.
  const available = trimmed ? isFontStackAvailable(trimmed) : null
  const derivedName =
    font?.fName ?? uniqueFontName(getDoc() ?? {}, fontNameFor(trimmed || 'Font', style))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed) return
    if (font) updateFontEntry(font.fName, { fFamily: trimmed, fStyle: style.trim() || 'Regular' })
    else addFontEntry({ family: trimmed, style })
    editFont(null)
  }

  return (
    <PopoverContent
      side="bottom"
      align="start"
      className="w-72 p-0"
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <form onSubmit={submit} className="flex flex-col">
        <div className="px-3 pt-3 pb-2 text-sm font-semibold text-fg">
          {font ? t.assets.font.editTitle : t.assets.font.addTitle}
        </div>
        <div className="flex flex-col gap-2 px-3 pb-3">
          <Field label={t.assets.font.family}>
            <TextInput
              autoFocus
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              placeholder="Inter"
              aria-invalid={!trimmed}
              list="le-font-families"
              className={HIDE_LIST_ARROW}
            />
          </Field>
          <Field label={t.assets.font.style}>
            <TextInput
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              list="le-font-styles"
              placeholder="Regular"
              className={HIDE_LIST_ARROW}
            />
          </Field>
          <Field label={t.assets.font.name}>
            <span className="truncate px-2 text-sm text-fg-subtle" title={t.assets.font.nameHint}>
              {derivedName}
            </span>
          </Field>
          {font?.fPath && (
            <Field label={t.assets.font.source}>
              <span className="selectable truncate px-2 text-sm text-fg-subtle" title={font.fPath}>
                {font.fPath}
              </span>
            </Field>
          )}
          <datalist id="le-font-families">
            {[
              ...new Set([
                ...(getDoc()?.fonts?.list ?? []).map((f) => f.fFamily),
                ...COMMON_FAMILIES,
              ]),
            ].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </datalist>
          <datalist id="le-font-styles">
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </datalist>
          <div
            className={cn(
              'mt-0.5 flex min-h-4 items-center gap-1.5 text-xs',
              available === null ? 'text-fg-faint' : available ? 'text-fg-muted' : 'text-warning',
            )}
          >
            {available !== null && (
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  available ? 'bg-success' : 'bg-warning',
                )}
                aria-hidden
              />
            )}
            <span>
              {available === null
                ? t.assets.font.familyRequired
                : available
                  ? t.assets.font.available
                  : t.assets.font.unavailable}
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => editFont(null)}>
            {t.common.cancel}
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!trimmed}>
            {font ? t.assets.font.save : t.assets.font.add}
          </Button>
        </div>
      </form>
    </PopoverContent>
  )
}
