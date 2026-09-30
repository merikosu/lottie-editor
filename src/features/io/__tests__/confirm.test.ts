import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animation } from '@/lottie/types'
import type { ConfirmProps } from '../dialog-ids'

const downloadCurrent = vi.fn(() => true)
vi.mock('../download', () => ({ downloadCurrent: () => downloadCurrent() }))

const { closeDocument, loadDocument, updateDoc } = await import('@/store/document')
const { setPrefs } = await import('@/store/prefs')
const { closeDialog, openDialog, useUi } = await import('@/store/ui')
const { answerConfirm, askConfirm, confirmReplace } = await import('../confirm')

const request = {
  title: 'Revert?',
  description: 'Sure?',
  confirmLabel: 'Revert',
  tone: 'primary' as const,
}

/** Props of the confirm dialog on screen (throws when another dialog, or none, is shown). */
function shown(): ConfirmProps {
  const dialog = useUi.getState().dialog
  if (dialog?.id !== 'io-confirm') throw new Error(`confirm dialog not shown (${dialog?.id})`)
  return dialog.props as ConfirmProps
}

function anim(): Animation {
  return { v: '5.7.4', fr: 30, ip: 0, op: 60, w: 100, h: 100, nm: 'A', layers: [] }
}

describe('askConfirm', () => {
  beforeEach(() => {
    closeDialog()
  })

  it('resolves with the answer and closes the dialog', async () => {
    const answer = askConfirm(request)
    const { token, title } = shown()
    expect(title).toBe('Revert?')
    answerConfirm(token, 'confirm')
    await expect(answer).resolves.toBe('confirm')
    expect(useUi.getState().dialog).toBeNull()
  })

  it('resolves "cancel" when the dialog goes away without an answer', async () => {
    const dismissed = askConfirm(request)
    closeDialog()
    await expect(dismissed).resolves.toBe('cancel')

    const replaced = askConfirm(request)
    openDialog('new-document')
    await expect(replaced).resolves.toBe('cancel')
    // The other dialog stays open.
    expect(useUi.getState().dialog?.id).toBe('new-document')
  })

  it('cancels an older question when a newer one replaces it', async () => {
    const first = askConfirm(request)
    const firstToken = shown().token
    const second = askConfirm({ ...request, title: 'Discard?', tone: 'danger' })
    await expect(first).resolves.toBe('cancel')
    expect(shown().title).toBe('Discard?')
    // A late answer to the old question changes nothing.
    answerConfirm(firstToken, 'confirm')
    expect(shown().title).toBe('Discard?')
    answerConfirm(shown().token, 'secondary')
    await expect(second).resolves.toBe('secondary')
  })
})

describe('confirmReplace', () => {
  beforeEach(() => {
    closeDialog()
    closeDocument()
    downloadCurrent.mockClear()
    setPrefs({ autosave: true })
  })

  it('does not ask when nothing can be lost', async () => {
    await expect(confirmReplace()).resolves.toBe(true)
    loadDocument(anim(), { fileName: 'a.json' })
    updateDoc('Edit', (d) => {
      d.nm = 'B'
    })
    // Autosave keeps the edited document in Recent.
    await expect(confirmReplace()).resolves.toBe(true)
    setPrefs({ autosave: false })
    closeDocument()
    loadDocument(anim(), { fileName: 'a.json' })
    // Unedited.
    await expect(confirmReplace()).resolves.toBe(true)
    expect(useUi.getState().dialog).toBeNull()
  })

  it('asks when autosave is off and the document has unsaved changes', async () => {
    setPrefs({ autosave: false })
    loadDocument(anim(), { fileName: 'a.json' })
    updateDoc('Edit', (d) => {
      d.nm = 'B'
    })

    const cancelled = confirmReplace()
    expect(shown()).toMatchObject({ tone: 'danger', secondaryLabel: expect.any(String) })
    answerConfirm(shown().token, 'cancel')
    await expect(cancelled).resolves.toBe(false)

    const discarded = confirmReplace()
    answerConfirm(shown().token, 'confirm')
    await expect(discarded).resolves.toBe(true)
    expect(downloadCurrent).not.toHaveBeenCalled()

    const downloaded = confirmReplace()
    answerConfirm(shown().token, 'secondary')
    await expect(downloaded).resolves.toBe(true)
    expect(downloadCurrent).toHaveBeenCalledTimes(1)
  })
})
