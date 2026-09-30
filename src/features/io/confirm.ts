/**
 * Promise-based confirmations for file actions (revert, discard unsaved changes).
 *
 * The pending question lives here rather than in the dialog component: React mounts components
 * twice in development and reuses the dialog instance when one confirmation replaces another, so
 * component state cannot tell "answered" from "dismissed". A question settles exactly once — with
 * the button the user chose, or with "cancel" as soon as its dialog is no longer on screen
 * (Escape, a click outside, another dialog or a newer question replacing it).
 */
import { getT } from '@/i18n'
import { isDirty, useDocument } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { closeDialog, openDialog, useUi } from '@/store/ui'
import { DIALOG, type ConfirmChoice, type ConfirmProps, type ConfirmRequest } from './dialog-ids'
import { downloadCurrent } from './download'

interface Pending {
  token: number
  resolve: (choice: ConfirmChoice) => void
  unsubscribe: () => void
}

let pending: Pending | null = null
let nextToken = 1

function isShowing(token: number): boolean {
  const dialog = useUi.getState().dialog
  return (
    dialog?.id === DIALOG.confirm && (dialog.props as ConfirmProps | undefined)?.token === token
  )
}

function settle(token: number, choice: ConfirmChoice): void {
  if (!pending || pending.token !== token) return
  const { resolve, unsubscribe } = pending
  pending = null
  unsubscribe()
  resolve(choice)
}

/** Shows the confirm dialog and resolves with the user's choice ('cancel' when dismissed). */
export function askConfirm(request: ConfirmRequest): Promise<ConfirmChoice> {
  if (pending) settle(pending.token, 'cancel')
  const token = nextToken++
  return new Promise((resolve) => {
    openDialog(DIALOG.confirm, { ...request, token } satisfies ConfirmProps)
    const unsubscribe = useUi.subscribe(() => {
      if (!isShowing(token)) settle(token, 'cancel')
    })
    pending = { token, resolve, unsubscribe }
  })
}

/** Answers the question shown by the confirm dialog and closes it. */
export function answerConfirm(token: number, choice: ConfirmChoice): void {
  const showing = isShowing(token)
  settle(token, choice)
  if (showing) closeDialog()
}

/**
 * Called before replacing or closing the document. With autosave on, nothing can be lost (the
 * document stays in Recent). With autosave off and unsaved changes, asks first; "Download copy"
 * saves the file and then goes ahead.
 */
export async function confirmReplace(): Promise<boolean> {
  const s = useDocument.getState()
  if (!s.doc || !s.meta || usePrefs.getState().autosave || !isDirty(s)) return true
  const t = getT()
  const choice = await askConfirm({
    title: t.io.confirm.discardTitle,
    description: t.io.confirm.discardDescription(s.meta.fileName),
    confirmLabel: t.io.confirm.discard,
    secondaryLabel: t.io.confirm.downloadFirst,
    tone: 'danger',
  })
  if (choice === 'secondary') return downloadCurrent()
  return choice === 'confirm'
}
