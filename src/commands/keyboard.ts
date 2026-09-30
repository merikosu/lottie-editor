/**
 * Global keyboard handler: dispatches shortcuts to registered commands.
 */
import { currentRoute } from '@/app/router'
import { isEditableTarget } from '@/lib/platform'
import { shortcutRoutes } from './scope'
import { isCommandEnabled, useCommandRegistry, type Command } from './registry'
import { matchesShortcut } from './shortcuts'

function shortcutsOf(cmd: Command): string[] {
  if (!cmd.shortcut) return []
  return Array.isArray(cmd.shortcut) ? cmd.shortcut : [cmd.shortcut]
}

/** Modal UI (dialogs, menus, listboxes, the command palette) swallows global shortcuts. */
function inModalOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    // Listboxes only count inside floating content (Radix Select); in-panel lists stay usable.
    !!target.closest(
      '[data-modal-dialog], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper] [role="listbox"], [cmdk-root]',
    )
  )
}

/** Non-modal floating panels (popovers such as the color picker). */
function inPopover(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[role="dialog"]')
}

export function handleShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing) return false
  const editable = isEditableTarget(e.target)
  const modal = inModalOverlay(e.target)
  const popover = !modal && inPopover(e.target)
  const route = currentRoute()
  for (const cmd of useCommandRegistry.getState().commands.values()) {
    const routes = shortcutRoutes(cmd)
    if (routes && !routes.includes(route)) continue
    for (const sc of shortcutsOf(cmd)) {
      if (!matchesShortcut(e, sc)) continue
      if ((editable || modal) && !cmd.allowInInput) continue
      if (popover && !cmd.allowInInput && !cmd.allowInPopover) continue
      if (e.repeat && !cmd.repeat) {
        e.preventDefault()
        return true
      }
      if (!isCommandEnabled(cmd)) continue
      e.preventDefault()
      void Promise.resolve(cmd.run()).catch((err) =>
        console.error(`Command "${cmd.id}" failed`, err),
      )
      return true
    }
  }
  return false
}

function onKeyDown(e: KeyboardEvent) {
  handleShortcut(e)
}

/** Installs the global handler; returns an uninstall function. */
export function installKeyboardShortcuts(): () => void {
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
