/**
 * Ids and props of the dialogs registered by the io feature.
 */
import type { Route } from '@/app/router'
import type { OpenResult } from '@/lottie/formats'
import type { RecentSource } from './storage'

export const DIALOG = {
  newDocument: 'new-document',
  openUrl: 'open-url',
  picker: 'dotlottie-picker',
  samples: 'samples',
  confirm: 'io-confirm',
} as const

/** How a file reached the editor (recent files remember it). */
export interface OpenInfo {
  source: RecentSource
  /** Overrides the document file name (pasted JSON has none). */
  fileName?: string
  /** Page to show the document on once it is open (see `revealDocument`). */
  route?: DocumentRoute
}

/** Pages that show the open document. */
export type DocumentRoute = Extract<Route, 'edit' | 'customize'>

export type PickerProps =
  /** Choose which animation of a file to open. */
  | { mode: 'open'; result: OpenResult; info: OpenInfo }
  /** Switch the edited animation of the open dotLottie. */
  | { mode: 'switch' }

export interface OpenUrlProps {
  /** Prefilled link. */
  url?: string
}

export type ConfirmChoice = 'confirm' | 'secondary' | 'cancel'

/** What `askConfirm` shows. */
export interface ConfirmRequest {
  title: string
  description: string
  confirmLabel: string
  tone: 'primary' | 'danger'
  /** Optional third button (e.g. "Download copy" before discarding). */
  secondaryLabel?: string
}

export interface ConfirmProps extends ConfirmRequest {
  /** Identifies the pending question (see confirm.ts); the answer is sent back with it. */
  token: number
}
