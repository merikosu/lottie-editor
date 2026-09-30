/**
 * Themes of the open document. They live in its dotLottie package (`DocumentMeta.dotLottie`):
 * the container the io feature keeps for a .lottie file and writes back on ⌘S and export
 * (themes are `t/<id>.json` files there, never part of the Lottie JSON). A document opened
 * from JSON gets a minimal container when its first theme is created, so export and autosave
 * handle it like any other package.
 *
 * Every function is pure: containers are never changed, new ones are returned (they go through
 * `commitPackage`, which makes the change one undo step).
 */
import {
  isDotLottieContainer,
  sanitizeDotLottieId,
  toDataUri,
  type DotLottieContainer,
  type DotLottieJsonEntry,
} from '@/lottie/dotlottie'
import { fileStem } from '@/lottie/formats'
import {
  defaultRule,
  findThemeRule,
  listSlots,
  readThemeRules,
  removeThemeRule,
  renameThemeRules,
  upsertThemeRule,
  type SlotInfo,
  type ThemeRule,
} from '@/lottie/slots'

export interface ThemeInfo {
  id: string
  /** Display name: the manifest `name`, else the id. */
  name: string
  rules: ThemeRule[]
}

/** The container of a document (null for documents without one, e.g. Telegram stickers). */
export function packageOf(value: unknown): DotLottieContainer | null {
  return isDotLottieContainer(value) ? value : null
}

/**
 * True when themes can be added: the document has a package, or nothing (a JSON document gets
 * one). Other sources (a Telegram sticker, saved back as .tgs) cannot hold themes.
 */
export function canHoldThemes(source: unknown): boolean {
  return source === undefined || source === null || isDotLottieContainer(source)
}

/**
 * A minimal container for a document that has none: one animation, named after the file.
 * Version 1 means "no preference": export writes dotLottie 2 as soon as themes exist.
 */
export function createPackage(fileName: string): DotLottieContainer {
  const id = sanitizeDotLottieId(fileStem(fileName) || 'animation', new Set())
  return {
    kind: 'dotlottie',
    version: 1,
    manifest: null,
    activeId: id,
    animations: [{ id, meta: {} }],
    themes: [],
    stateMachines: [],
    extraFiles: {},
  }
}

/** Id of the edited animation inside its package (theme rules may be limited to animations). */
export function activeAnimationId(pkg: DotLottieContainer | null): string | null {
  return pkg ? pkg.activeId : null
}

const rulesCache = new WeakMap<object, ThemeRule[]>()
const themesCache = new WeakMap<object, ThemeInfo[]>()

/** Rules of a theme file, cached by its data object (the same data keeps the same array). */
export function rulesOf(data: unknown): ThemeRule[] {
  if (data === null || typeof data !== 'object') return []
  let rules = rulesCache.get(data)
  if (!rules) {
    rules = readThemeRules(data)
    rulesCache.set(data, rules)
  }
  return rules
}

export function themeName(entry: Pick<DotLottieJsonEntry, 'id' | 'name'>): string {
  return entry.name?.trim() || entry.id
}

/** The package's themes in manifest order (cached by the themes array). */
export function listThemes(pkg: DotLottieContainer | null): ThemeInfo[] {
  if (!pkg) return []
  const hit = themesCache.get(pkg.themes)
  if (hit) return hit
  const list = pkg.themes.map((t) => ({ id: t.id, name: themeName(t), rules: rulesOf(t.data) }))
  themesCache.set(pkg.themes, list)
  return list
}

export function findTheme(pkg: DotLottieContainer | null, id: string | null): ThemeInfo | null {
  if (!id) return null
  return listThemes(pkg).find((t) => t.id === id) ?? null
}

/** Theme the edited animation starts with (its manifest `initialTheme`), if it exists. */
export function initialThemeId(pkg: DotLottieContainer | null): string | null {
  if (!pkg) return null
  const entry = pkg.animations.find((a) => a.id === pkg.activeId)
  const id = entry?.meta.initialTheme
  return typeof id === 'string' && pkg.themes.some((t) => t.id === id) ? id : null
}

/* -------------------------------------------------------------------------- */
/*                                   Themes                                   */
/* -------------------------------------------------------------------------- */

/** True when another theme already shows `name` (case-insensitive, trimmed). */
export function isThemeNameTaken(
  pkg: DotLottieContainer | null,
  name: string,
  exceptId?: string,
): boolean {
  const key = name.trim().toLowerCase()
  return listThemes(pkg).some((t) => t.id !== exceptId && t.name.toLowerCase() === key)
}

/**
 * Id for a new theme: the name as developers would type it (`Dark mode` → `dark_mode`,
 * Cyrillic transliterated), unique case-insensitively (theme files share one folder).
 */
export function themeIdFor(pkg: DotLottieContainer | null, name: string): string {
  const used = new Set((pkg?.themes ?? []).map((t) => t.id.toLowerCase()))
  const slug = name.trim().toLowerCase().replace(/\s+/g, '_')
  return sanitizeDotLottieId(slug, used, 'theme')
}

/** Animations with updated manifest entries (the same array when nothing changed). */
function withAnimationMeta(
  pkg: DotLottieContainer,
  update: (meta: Record<string, unknown>, id: string) => Record<string, unknown>,
): DotLottieContainer['animations'] {
  let changed = false
  const animations = pkg.animations.map((a) => {
    const meta = update(a.meta, a.id)
    if (meta === a.meta) return a
    changed = true
    return { ...a, meta }
  })
  return changed ? animations : pkg.animations
}

/**
 * Adds a theme named `name` (a copy of the rules of `copyOf`, or empty). Animations that list
 * their themes (`animations[].themes` in the manifest) get the new one listed too.
 */
export function addTheme(
  pkg: DotLottieContainer,
  name: string,
  copyOf?: string,
): { pkg: DotLottieContainer; id: string } {
  const id = themeIdFor(pkg, name)
  const source = copyOf ? pkg.themes.find((t) => t.id === copyOf) : undefined
  const data = source ? JSON.parse(JSON.stringify(source.data)) : { rules: [] }
  const entry: DotLottieJsonEntry = { id, name: name.trim(), data }
  const animations = withAnimationMeta(pkg, (meta) =>
    Array.isArray(meta.themes) ? { ...meta, themes: [...meta.themes, id] } : meta,
  )
  return { pkg: { ...pkg, themes: [...pkg.themes, entry], animations }, id }
}

export function renameTheme(pkg: DotLottieContainer, id: string, name: string): DotLottieContainer {
  const next = name.trim()
  if (!next) return pkg
  let changed = false
  const themes = pkg.themes.map((t) => {
    if (t.id !== id || themeName(t) === next) return t
    changed = true
    return { ...t, name: next }
  })
  return changed ? { ...pkg, themes } : pkg
}

/** Removes a theme and every reference to it (starting theme, per-animation theme lists). */
export function deleteTheme(pkg: DotLottieContainer, id: string): DotLottieContainer {
  if (!pkg.themes.some((t) => t.id === id)) return pkg
  const animations = withAnimationMeta(pkg, (meta) => {
    let out = meta
    if (meta.initialTheme === id) {
      out = { ...out }
      delete out.initialTheme
    }
    if (Array.isArray(meta.themes) && meta.themes.includes(id))
      out = { ...out, themes: meta.themes.filter((t) => t !== id) }
    return out
  })
  return { ...pkg, themes: pkg.themes.filter((t) => t.id !== id), animations }
}

/** Moves a theme to `index` (the order of the manifest, and of the theme bar). */
export function moveTheme(pkg: DotLottieContainer, id: string, index: number): DotLottieContainer {
  const from = pkg.themes.findIndex((t) => t.id === id)
  const to = Math.max(0, Math.min(pkg.themes.length - 1, index))
  if (from < 0 || from === to) return pkg
  const themes = [...pkg.themes]
  const [entry] = themes.splice(from, 1)
  themes.splice(to, 0, entry)
  return { ...pkg, themes }
}

/** Makes `id` (or no theme, null) the theme the edited animation starts with. */
export function setInitialTheme(pkg: DotLottieContainer, id: string | null): DotLottieContainer {
  if (id !== null && !pkg.themes.some((t) => t.id === id)) return pkg
  const animations = withAnimationMeta(pkg, (meta, animationId) => {
    if (animationId !== pkg.activeId) return meta
    if (id === null) {
      if (!('initialTheme' in meta)) return meta
      const out = { ...meta }
      delete out.initialTheme
      return out
    }
    return meta.initialTheme === id ? meta : { ...meta, initialTheme: id }
  })
  return animations === pkg.animations ? pkg : { ...pkg, animations }
}

/* -------------------------------------------------------------------------- */
/*                                   Values                                   */
/* -------------------------------------------------------------------------- */

function mapTheme(
  pkg: DotLottieContainer,
  themeId: string | null,
  update: (data: unknown) => unknown,
): DotLottieContainer {
  let changed = false
  const themes = pkg.themes.map((t) => {
    if (themeId !== null && t.id !== themeId) return t
    const data = update(t.data)
    if (data === t.data) return t
    changed = true
    return { ...t, data }
  })
  return changed ? { ...pkg, themes } : pkg
}

/** Sets the value a theme gives a slot of the edited animation. */
export function setRule(
  pkg: DotLottieContainer,
  themeId: string,
  rule: ThemeRule,
): DotLottieContainer {
  return mapTheme(pkg, themeId, (data) => upsertThemeRule(data, rule, pkg.activeId))
}

/** Removes a theme's value for a slot: the slot shows its default value in that theme. */
export function clearRule(
  pkg: DotLottieContainer,
  themeId: string,
  slotId: string,
): DotLottieContainer {
  return mapTheme(pkg, themeId, (data) => removeThemeRule(data, slotId, pkg.activeId))
}

/**
 * Gives every theme (or one) a rule for each slot it has no rule for, with the slot's default
 * value. Players apply a theme over whatever the previous one set (see `defaultRule`), so
 * complete themes look the same in any order.
 */
export function fillRules(
  pkg: DotLottieContainer,
  slots: readonly SlotInfo[],
  themeId: string | null = null,
): DotLottieContainer {
  return mapTheme(pkg, themeId, (data) => {
    let next = data
    for (const slot of slots) {
      if (findThemeRule(rulesOf(next), slot.id, pkg.activeId)) continue
      const rule = defaultRule(slot)
      if (rule) next = upsertThemeRule(next, rule, pkg.activeId)
    }
    return next
  })
}

/** True when another animation of the package binds something to `slotId`. */
export function slotUsedElsewhere(pkg: DotLottieContainer | null, slotId: string): boolean {
  if (!pkg) return false
  return pkg.animations.some(
    (a) => a.id !== pkg.activeId && !!a.data && listSlots(a.data).some((s) => s.id === slotId),
  )
}

/**
 * Follows a slot rename in every theme. Other animations of the package that use the old id
 * keep their rules (the renamed copies are added next to them).
 */
export function renameSlotRules(
  pkg: DotLottieContainer,
  from: string,
  to: string,
): DotLottieContainer {
  const keep = slotUsedElsewhere(pkg, from)
  return mapTheme(pkg, null, (data) => renameThemeRules(data, from, to, pkg.activeId, keep))
}

/** Removes a slot's rules from every theme, unless other animations of the package use it. */
export function dropSlotRules(pkg: DotLottieContainer, slotId: string): DotLottieContainer {
  if (slotUsedElsewhere(pkg, slotId)) return pkg
  return mapTheme(pkg, null, (data) => removeThemeRule(data, slotId, pkg.activeId))
}

/**
 * URL of a package image an Image rule names by file name (`logo_dark.png` → `i/logo_dark.png`),
 * as a data URI lottie-web can show.
 */
export function resolvePackageImage(
  pkg: DotLottieContainer | null,
  src: string,
): string | undefined {
  if (!pkg) return undefined
  const name = src.replace(/^\/+/, '')
  for (const path of [`i/${name}`, `images/${name}`, name]) {
    const bytes = pkg.extraFiles[path]
    if (bytes) return toDataUri(bytes, path)
  }
  return undefined
}
