/**
 * Internationalization.
 *
 * Dictionaries are plain typed objects (one file per namespace in locales/<lang>/).
 * Components read strings by property access: `const t = useT(); t.layers.title`.
 * Interpolation/plurals are functions in the dictionary: `t.layers.count(5)`.
 * The Russian dictionary must have exactly the same shape as the English one (type-checked).
 *
 * English ships in the main bundle (source of truth and fallback); other languages are
 * loaded on demand — main.tsx awaits `ensureLanguage()` before the first render.
 */
import { create } from 'zustand'
import { setByteUnits, setNumberLocale, setSecondsUnit } from '@/lib/format'
import { usePrefs } from '@/store/prefs'
import en from './locales/en'
import type { Language } from './detect'

export type Dict = typeof en

const loaders: Record<Language, () => Promise<Dict>> = {
  en: async () => en,
  ru: () => import('./locales/ru').then((m) => m.default),
}

const dictionaries: Partial<Record<Language, Dict>> = { en }

/** Bumped when a dictionary finishes loading so hooks re-render. */
const useLoaded = create<{ version: number }>()(() => ({ version: 0 }))

export { LANGUAGES, detectLanguage, type Language } from './detect'
export { pluralEn, pluralRu } from './plural'

/** Loads a language's dictionary (no-op when already loaded). */
export async function ensureLanguage(language: Language): Promise<void> {
  if (dictionaries[language]) return
  dictionaries[language] = await loaders[language]()
  useLoaded.setState((s) => ({ version: s.version + 1 }))
  if (usePrefs.getState().language === language) applyFormatting(language)
}

/** Every dictionary loaded so far (e.g. to search command titles in all languages). */
export function loadedDictionaries(): Dict[] {
  return Object.values(dictionaries).filter((d): d is Dict => !!d)
}

/** Loads every UI language (used by the command palette's cross-language search). */
export async function ensureAllLanguages(): Promise<void> {
  await Promise.all((Object.keys(loaders) as Language[]).map((l) => ensureLanguage(l)))
}

/** React hook: the dictionary of the current UI language. */
export function useT(): Dict {
  const language = usePrefs((s) => s.language)
  useLoaded((s) => s.version)
  return dictionaries[language] ?? en
}

/** Non-reactive access for commands, stores and other non-React code. */
export function getT(): Dict {
  return dictionaries[usePrefs.getState().language] ?? en
}

export function useLanguage(): Language {
  return usePrefs((s) => s.language)
}

/** Switches the UI language (after its dictionary has loaded, so nothing flashes). */
export function setLanguage(language: Language): void {
  void ensureLanguage(language).then(() => {
    usePrefs.setState({ language })
    document.documentElement.lang = language
  })
}

// Keep locale-dependent formatting helpers in sync with the UI language.
function applyFormatting(language: Language) {
  const dict = dictionaries[language] ?? en
  setByteUnits(dict.common.byteUnits)
  setSecondsUnit(dict.common.secondsShort)
  setNumberLocale(language)
}
applyFormatting(usePrefs.getState().language)
usePrefs.subscribe((s, prev) => {
  if (s.language !== prev.language) {
    applyFormatting(s.language)
    void ensureLanguage(s.language)
  }
})
