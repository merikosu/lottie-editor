/**
 * Themes & slots.
 *
 * Integration (owned elsewhere):
 * - Inspector document view: mount `<ThemesSection />` (e.g. after the document colors, inside
 *   the same error boundary as the other foreign sections).
 * - Canvas preview: the viewport shows `previewDocument(doc)` instead of `doc`, and reloads when
 *   `subscribeActiveThemeRules` fires. The themed copy keeps its identity while nothing changes,
 *   so `rendersSame` short-circuits repeated requests. `<ThemePreviewBadge />` belongs in the
 *   canvas overlay (e.g. top left) so a themed canvas is never mistaken for the document.
 * - Colors panel: `<ThemeColorMenuItem usages={…} />` in a color's context menu.
 * - Inspector property rows: `<SlotBadge path={propertyPath} />` marks properties bound to a
 *   theme color (nothing renders for other properties).
 */
export { ThemesSection } from './ThemesSection'
export { ThemePreviewBadge } from './ThemePreviewBadge'
export { ThemeColorMenuItem } from './ThemeColorMenuItem'
export { SlotBadge } from './SlotBadge'
export {
  getActiveThemeName,
  getActiveThemeRules,
  previewDocument,
  subscribeActiveThemeRules,
  useActiveThemeName,
  useActiveThemeRules,
} from './preview'
export { exportWithThemes, makeThemeColor, revealThemesSection, selectTheme } from './actions'
export { listThemes, packageOf } from './model'
