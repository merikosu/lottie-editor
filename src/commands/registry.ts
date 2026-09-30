/**
 * Command registry. Features register commands (id, title, shortcut, run); menus, the
 * command palette and the keyboard handler all read from here, so every action is
 * discoverable and has one implementation.
 */
import type { ComponentType } from 'react'
import { create } from 'zustand'
import type { Route } from '@/app/router'
import type { Dict } from '@/i18n'

export type CommandCategory = 'file' | 'edit' | 'view' | 'animation' | 'layer' | 'playback' | 'help'

export interface IconProps {
  size?: number | string
  className?: string
  strokeWidth?: number | string
}

export interface Command {
  /** Unique id, e.g. "file.open". */
  id: string
  title: (t: Dict) => string
  category: CommandCategory
  icon?: ComponentType<IconProps>
  /** One or more shortcuts; the first one is displayed. */
  shortcut?: string | string[]
  run: () => void | Promise<void>
  /** Disabled commands are greyed out in menus and ignored by shortcuts. */
  enabled?: () => boolean
  /** For toggles: shows a check mark in menus. */
  checked?: () => boolean
  /** Extra search terms for the command palette. */
  keywords?: string[]
  /** Hide from the command palette. */
  hidden?: boolean
  /** Allow the shortcut while a text field is focused (e.g. mod+s). */
  allowInInput?: boolean
  /** Allow the shortcut inside non-modal popovers (e.g. undo while a color picker is open). */
  allowInPopover?: boolean
  /**
   * Shortcut shown in menus/palette without binding it (e.g. ⌘V for Paste, which must stay a
   * native paste event).
   */
  displayShortcut?: string
  /** Pages where the shortcut is active; defaults by category (see commands/scope.ts). */
  routes?: Route[]
  /** Fire repeatedly while the key is held (e.g. frame stepping). */
  repeat?: boolean
}

interface RegistryState {
  commands: Map<string, Command>
  version: number
}

export const useCommandRegistry = create<RegistryState>()(() => ({
  commands: new Map(),
  version: 0,
}))

/** Registers commands; returns a function that unregisters them. Later ids replace earlier ones. */
export function registerCommands(commands: Command[]): () => void {
  useCommandRegistry.setState((s) => {
    const next = new Map(s.commands)
    for (const c of commands) next.set(c.id, c)
    return { commands: next, version: s.version + 1 }
  })
  return () => {
    useCommandRegistry.setState((s) => {
      const next = new Map(s.commands)
      for (const c of commands) if (next.get(c.id) === c) next.delete(c.id)
      return { commands: next, version: s.version + 1 }
    })
  }
}

export function getCommand(id: string): Command | undefined {
  return useCommandRegistry.getState().commands.get(id)
}

export function isCommandEnabled(cmd: Command | undefined): boolean {
  if (!cmd) return false
  try {
    return cmd.enabled ? cmd.enabled() : true
  } catch {
    return false
  }
}

/** Runs a command by id if it exists and is enabled. Returns true if it ran. */
export function runCommand(id: string): boolean {
  const cmd = getCommand(id)
  if (!cmd || !isCommandEnabled(cmd)) return false
  void Promise.resolve(cmd.run()).catch((err) => console.error(`Command "${id}" failed`, err))
  return true
}

export function primaryShortcut(cmd: Command | undefined): string | undefined {
  if (!cmd) return undefined
  if (!cmd.shortcut) return cmd.displayShortcut
  return Array.isArray(cmd.shortcut) ? cmd.shortcut[0] : cmd.shortcut
}

/** Hook: re-renders when commands are (un)registered. */
export function useCommands(): Map<string, Command> {
  return useCommandRegistry((s) => s.commands)
}

export function useCommand(id: string): Command | undefined {
  return useCommandRegistry((s) => s.commands.get(id))
}
