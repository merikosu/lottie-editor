/**
 * Themes section of the inspector's document view (nothing selected): the animation's theme
 * colors (Lottie slots) and the dotLottie themes that give them other values. Selecting a theme
 * edits its values and shows it on the canvas; Default edits the document itself.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Section } from '@/components/ui'
import { useT } from '@/i18n'
import { listSlots } from '@/lottie/slots'
import { useDocument } from '@/store/document'
import { exportWithThemes, THEMES_SECTION_ID } from './actions'
import { AddColorButton } from './AddColorButton'
import { activeAnimationId, canHoldThemes, initialThemeId, listThemes, packageOf } from './model'
import { SlotList } from './SlotList'
import { useSelectedThemeId, useThemesUi } from './store'
import { ThemeBar } from './ThemeBar'

/** Reveal requests already handled (a remount must not scroll again). */
let handledReveal = 0

export function ThemesSection() {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const pkg = useDocument((s) => packageOf(s.meta?.dotLottie))
  const format = useDocument((s) => s.meta?.format)
  const allowThemes = useDocument((s) => canHoldThemes(s.meta?.dotLottie))
  const selectedId = useSelectedThemeId()
  const revealTick = useThemesUi((s) => s.revealTick)
  const ref = useRef<HTMLDivElement>(null)

  const slots = useMemo(() => (doc ? listSlots(doc) : []), [doc])
  const themes = listThemes(pkg)
  const theme = themes.find((th) => th.id === selectedId) ?? null

  useEffect(() => {
    if (revealTick <= handledReveal) return
    handledReveal = revealTick
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [revealTick])

  if (!doc) return null
  const empty = slots.length === 0 && themes.length === 0

  return (
    <div ref={ref} data-testid="themes-section">
      <Section
        id={THEMES_SECTION_ID}
        title={
          <span className="flex items-baseline gap-1.5">
            {t.themes.title}
            {themes.length > 0 && (
              <span className="font-normal text-fg-subtle tabular-nums">{themes.length}</span>
            )}
          </span>
        }
        contentClassName="gap-2"
      >
        {empty ? (
          <>
            <p className="text-xs text-fg-subtle">{t.themes.empty.hint}</p>
            <AddColorButton label={t.themes.empty.add} variant="secondary" />
          </>
        ) : (
          <>
            <ThemeBar
              themes={themes}
              selectedId={theme?.id ?? null}
              initialId={initialThemeId(pkg)}
              allowNew={allowThemes}
            />
            {slots.length > 0 ? (
              <SlotList slots={slots} theme={theme} animationId={activeAnimationId(pkg)} />
            ) : (
              <p className="text-xs text-fg-subtle">{t.themes.empty.hint}</p>
            )}
            <AddColorButton label={t.themes.addColor} />
            {themes.length === 0 && slots.length > 0 && (
              <p className="text-xs text-fg-subtle">
                {allowThemes ? t.themes.noThemes : t.themes.errors.unsupported}
              </p>
            )}
            {themes.length > 0 && format !== 'lottie' && (
              <p className="text-xs text-fg-subtle">
                {t.themes.savedIn}{' '}
                <button
                  type="button"
                  onClick={exportWithThemes}
                  className="rounded-xs text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-fg hover:decoration-fg-subtle"
                >
                  {t.themes.exportLink}
                </button>
              </p>
            )}
          </>
        )}
      </Section>
    </div>
  )
}
