export type Language = 'en' | 'ru'

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ru', label: 'Русский' },
]

/** Picks the UI language from the browser settings (Russian if preferred, else English). */
export function detectLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en'
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const l of langs) {
    const code = l?.toLowerCase().slice(0, 2)
    if (code === 'ru' || code === 'uk' || code === 'be' || code === 'kk') return 'ru'
    if (code === 'en') return 'en'
  }
  return 'en'
}
