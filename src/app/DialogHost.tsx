import { createElement, Suspense } from 'react'
import { useDialogRegistry } from '@/commands/dialogs'
import { closeDialog, useUi } from '@/store/ui'
import { ErrorBoundary } from './ErrorBoundary'

/** Renders the currently open registered dialog. */
export function DialogHost() {
  const dialog = useUi((s) => s.dialog)
  const Component = useDialogRegistry((s) => (dialog ? s.dialogs.get(dialog.id) : undefined))
  if (!dialog || !Component) return null
  return (
    <ErrorBoundary name={`dialog:${dialog.id}`} compact>
      <Suspense fallback={null}>
        {createElement(Component, {
          key: dialog.id,
          props: dialog.props as never,
          close: closeDialog,
        })}
      </Suspense>
    </ErrorBoundary>
  )
}
