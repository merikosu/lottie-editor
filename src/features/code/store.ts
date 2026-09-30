/**
 * State shared by the JSON view's pieces: the toolbar (rendered in the app header), the
 * lazily loaded editor and the commands. The editor owns the CodeMirror instance and
 * publishes its status here; everything else talks to it through `CodeController`.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NodePath } from '@/lottie/path'
import type { JsonErrorCode } from './json-scan'
import type { LottieShapeCode } from './validate'

export type CodeError =
  | {
      kind: 'json'
      code: JsonErrorCode
      found: string
      pos: number
      end: number
      line: number
      col: number
    }
  | {
      kind: 'lottie'
      code: LottieShapeCode
      path: NodePath
      pos: number
      end: number
      line: number
      col: number
    }

export interface CodeStatus {
  /** The editor is mounted and shows the document. */
  ready: boolean
  /** The text differs from the document (edits not applied yet). */
  dirty: boolean
  /** The document changed while there were local edits. */
  stale: boolean
  /** The user chose to keep editing despite `stale`. */
  staleDismissed: boolean
  /** First syntax or structure problem of the edited text (only while dirty). */
  error: CodeError | null
  lines: number
  /** UTF-8 size of the editor text. */
  bytes: number
  line: number
  col: number
  /** JSON path at the cursor, or null while it is not known yet. */
  cursorPath: NodePath | null
  /** A large document is waiting for the user's confirmation before being shown. */
  largeDoc: number | null
  /** Short-lived notice (e.g. "not found"), cleared automatically. */
  notice: string | null
}

export const INITIAL_STATUS: CodeStatus = {
  ready: false,
  dirty: false,
  stale: false,
  staleDismissed: false,
  error: null,
  lines: 0,
  bytes: 0,
  line: 1,
  col: 1,
  cursorPath: null,
  largeDoc: null,
  notice: null,
}

export const useCodeStatus = create<CodeStatus>()(() => INITIAL_STATUS)

export function setCodeStatus(patch: Partial<CodeStatus>): void {
  useCodeStatus.setState(patch)
}

/* ------------------------------ Preferences ------------------------------ */

interface CodePrefs {
  followSelection: boolean
}

export const useCodePrefs = create<CodePrefs>()(
  persist((): CodePrefs => ({ followSelection: false }), {
    name: 'lottie-editor:code',
    version: 1,
  }),
)

export function toggleFollowSelection(): void {
  useCodePrefs.setState((s) => ({ followSelection: !s.followSelection }))
}

/* ------------------------------ Controller ------------------------------- */

export interface RevealOptions {
  /** Move keyboard focus into the editor (explicit "Show in JSON"). */
  focus?: boolean
}

/** Imperative API of the mounted editor. */
export interface CodeController {
  apply: () => boolean
  revert: () => void
  format: () => boolean
  reveal: (path: NodePath, opts?: RevealOptions) => boolean
  jumpTo: (pos: number) => void
  openSearch: () => void
  focus: () => void
  /** Confirms showing a large document. */
  openLarge: () => void
  /** True when keyboard focus is inside the editor (or its search panel). */
  hasFocus: () => boolean
}

let controller: CodeController | null = null

export function setCodeController(next: CodeController | null): void {
  controller = next
}

export function getCodeController(): CodeController | null {
  return controller
}

/* ---------------------------- Pending reveals ---------------------------- */

interface PendingReveal {
  path: NodePath
  focus: boolean
}

let pendingReveal: PendingReveal | null = null

/** Reveals a node now if the editor is mounted, otherwise as soon as it is. */
export function requestReveal(path: NodePath, focus: boolean): void {
  if (controller && useCodeStatus.getState().ready) {
    controller.reveal(path, { focus })
    return
  }
  pendingReveal = { path, focus }
}

/** Takes the reveal requested before the editor was ready (called by the editor). */
export function takePendingReveal(): PendingReveal | null {
  const p = pendingReveal
  pendingReveal = null
  return p
}

/* ------------------------------ Derived state ----------------------------- */

export function canApply(s: CodeStatus = useCodeStatus.getState()): boolean {
  return s.ready && s.dirty && s.error === null
}

/** True while the JSON view holds edits that are not applied (for a "draft" dot elsewhere). */
export function useHasCodeDraft(): boolean {
  return useCodeStatus((s) => s.dirty)
}

export function canFormat(s: CodeStatus = useCodeStatus.getState()): boolean {
  return s.ready && !(s.error?.kind === 'json')
}
