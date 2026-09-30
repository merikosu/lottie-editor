/**
 * Dialog registry: features register dialog components by id; `openDialog(id, props)`
 * (from store/ui) shows them through the single <DialogHost/>.
 */
import type { ComponentType } from 'react'
import { create } from 'zustand'

export interface DialogComponentProps<P = unknown> {
  /** Props passed to openDialog(id, props). */
  props: P
  /** Closes the dialog. */
  close: () => void
}

interface DialogRegistry {
  dialogs: Map<string, ComponentType<DialogComponentProps<never>>>
}

export const useDialogRegistry = create<DialogRegistry>()(() => ({ dialogs: new Map() }))

export function registerDialog<P>(
  id: string,
  component: ComponentType<DialogComponentProps<P>>,
): () => void {
  useDialogRegistry.setState((s) => {
    const dialogs = new Map(s.dialogs)
    dialogs.set(id, component as ComponentType<DialogComponentProps<never>>)
    return { dialogs }
  })
  return () =>
    useDialogRegistry.setState((s) => {
      const dialogs = new Map(s.dialogs)
      if (dialogs.get(id) === (component as unknown)) dialogs.delete(id)
      return { dialogs }
    })
}
