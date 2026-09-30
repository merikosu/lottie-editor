/**
 * Keyboard of the detail view. The app's global shortcuts act on the editor's document (Space
 * plays it, arrows step its frames) even while another page shows, so the detail view listens
 * first (capture phase) and takes the keys it uses:
 *   Space play/pause · ←/→ frame (⇧ 10) · Home/End · ↑/↓ previous/next file · Esc all files ·
 *   1/2/3 comparison mode · B background · ⇧1 fit · =/− zoom
 * Keys typed into fields, menus, dialogs and the command palette are left alone, and controls
 * that use arrows themselves (sliders, tabs, radio groups, lists) keep them.
 */
import { useEffect } from 'react'
import { matchesShortcut } from '@/commands/shortcuts'
import { isEditableTarget } from '@/lib/platform'
import {
  setOptimizerSettings,
  useOptimizerSettings,
  type StageBackground,
} from '../../model/settings'
import { selectJob, stepSelection } from '../../model/store'
import type { FrameClock } from './clock'
import { FIT_VIEW, MAX_ZOOM, MIN_ZOOM, type View } from './layout'

const OVERLAY =
  '[data-modal-dialog], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [cmdk-root]'
const USES_ARROWS =
  '[role="slider"], [role="radio"], [role="radiogroup"], [role="tab"], [role="tablist"], [role="menuitem"], [role="option"], [role="spinbutton"], [role="combobox"], [aria-haspopup], select, input[type="range"], input[type="radio"]'
/** Open menus, lists and popovers own the keyboard (focus may still sit on their trigger). */
const OPEN_POPUP = '[role="listbox"], [role="menu"], [role="dialog"], [cmdk-root]'

const BACKGROUNDS: StageBackground[] = ['checker', 'dark', 'light']
const ZOOM_STEP = 1.25

function zoomBy(view: View, factor: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor))
  const k = zoom / view.zoom
  // Zooming around the stage's center scales the offset from it.
  return { zoom, pan: { x: view.pan.x * k, y: view.pan.y * k } }
}

export function useDetailKeys(
  clock: FrameClock,
  setView: (update: (view: View) => View) => void,
): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const target = e.target instanceof Element ? e.target : null
      if (isEditableTarget(e.target) || target?.closest(OVERLAY)) return
      if (document.querySelector(OPEN_POPUP)) return
      const arrowsTaken = !!target?.closest(USES_ARROWS)
      const inSidebar = !!target?.closest('[data-opt-sidebar]')
      const take = (run: () => void) => {
        e.preventDefault()
        e.stopPropagation()
        run()
      }
      const is = (shortcut: string) => matchesShortcut(e, shortcut)

      if (is('space')) return take(() => clock.toggle())
      if (is('escape')) return take(() => selectJob(null))
      if (!arrowsTaken) {
        if (is('left')) return take(() => clock.step(-1))
        if (is('right')) return take(() => clock.step(1))
        if (is('shift+left')) return take(() => clock.step(-10))
        if (is('shift+right')) return take(() => clock.step(10))
        if (is('home')) return take(() => (clock.pause(), clock.seek(clock.bounds.ip)))
        if (is('end')) return take(() => (clock.pause(), clock.seek(clock.last)))
        if (!inSidebar && is('up')) return take(() => stepSelection(-1))
        if (!inSidebar && is('down')) return take(() => stepSelection(1))
      }
      if (is('1')) return take(() => setOptimizerSettings({ compareMode: 'side' }))
      if (is('2')) return take(() => setOptimizerSettings({ compareMode: 'swipe' }))
      if (is('3')) return take(() => setOptimizerSettings({ compareMode: 'difference' }))
      if (is('b')) {
        return take(() => {
          const current = useOptimizerSettings.getState().background
          const next = BACKGROUNDS[(BACKGROUNDS.indexOf(current) + 1) % BACKGROUNDS.length]
          setOptimizerSettings({ background: next })
        })
      }
      if (is('shift+1')) return take(() => setView(() => FIT_VIEW))
      if (is('=') || is('shift+=')) return take(() => setView((v) => zoomBy(v, ZOOM_STEP)))
      if (is('-')) return take(() => setView((v) => zoomBy(v, 1 / ZOOM_STEP)))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [clock, setView])
}
