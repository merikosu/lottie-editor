/**
 * A replacement in progress (the Replace dialog). The result is shown live — in the Customize
 * preview or the editor canvas — by writing it to the document as ONE history entry that every
 * change of the dialog updates (coalesced by the session's key). Each update is computed from
 * the document as it was when the dialog opened. Apply closes the entry; Cancel takes it back
 * out of the history, leaving no redo step behind.
 */
import { uid } from '@/lib/id'
import type { Box } from '@/lottie/bounds'
import type { NodePath } from '@/lottie/path'
import { replaceTargetKind, representativeFrame, type ReplaceWarning } from '@/lottie/replace'
import type { Animation } from '@/lottie/types'
import { getDoc, isDirty, markSaved, replaceDoc, undo, useDocument } from '@/store/document'
import { computeReplace, type ReplaceContent, type ReplaceSettings } from './compute'

/** The document was changed by something else while the dialog was open. */
export class StaleSessionError extends Error {
  constructor() {
    super('The animation changed while the replacement was being set up')
    this.name = 'StaleSessionError'
  }
}

export type UpdateResult =
  { ok: true; warnings: ReplaceWarning[]; instances: number } | { ok: false; error: unknown }

export class ReplaceSession {
  readonly key = uid('replace')
  readonly target: NodePath
  /** The document before the replacement. */
  readonly base: Animation
  /** Resting frame of the target (containing composition time) and its bounds then. */
  readonly frame: number
  readonly box: Box | null
  private readonly label: string
  /** The file had no unsaved changes when the dialog opened (Cancel leaves it that way). */
  private readonly clean: boolean
  /** The session's history entry exists (at the end of the history). */
  private recorded = false
  private done = false

  private constructor(base: Animation, target: NodePath, label: string) {
    this.base = base
    this.target = target
    this.label = label
    this.clean = !isDirty()
    const rep = representativeFrame(base, target)
    this.frame = rep.frame
    this.box = rep.bounds
  }

  /** Starts a session for the element at `target`; null when it cannot be replaced. */
  static start(target: NodePath, label: string): ReplaceSession | null {
    const doc = getDoc()
    if (!doc || !replaceTargetKind(doc, target)) return null
    return new ReplaceSession(doc, target, label)
  }

  /** The document changed under the session (another edit, undo): its result is not current. */
  isCurrent(): boolean {
    const s = useDocument.getState()
    if (!this.recorded) return s.doc === this.base
    return s.past[s.past.length - 1]?.coalesceKey === this.key && s.future.length === 0
  }

  /** Shows the replacement with `content` and `settings` (replacing the previous preview). */
  update(content: ReplaceContent, settings: ReplaceSettings): UpdateResult {
    if (this.done || !getDoc() || !this.isCurrent())
      return { ok: false, error: new StaleSessionError() }
    let out
    try {
      out = computeReplace(this.base, {
        target: this.target,
        content,
        settings,
        frame: this.frame,
        box: this.box,
      })
    } catch (error) {
      return { ok: false, error }
    }
    replaceDoc(this.label, out.doc, {
      coalesceKey: this.key,
      final: false,
      selection: { nodes: [out.target], keyframes: [], property: null },
    })
    this.recorded = true
    return { ok: true, warnings: out.warnings, instances: out.instances }
  }

  /** Keeps the result as one undo step. Returns false when there was nothing to apply. */
  apply(): boolean {
    if (this.done) return false
    this.done = true
    const doc = getDoc()
    if (!this.recorded || !doc || !this.isCurrent()) return false
    // Same document, final update: closes the history entry.
    replaceDoc(this.label, doc, { coalesceKey: this.key, final: true })
    return true
  }

  /** Reverts the preview and removes it from the history. */
  cancel(): void {
    if (this.done) return
    this.done = true
    if (!this.recorded || !this.isCurrent()) return
    const entry = undo()
    if (entry?.coalesceKey === this.key) {
      useDocument.setState((s) =>
        s.future[0]?.coalesceKey === this.key ? { future: s.future.slice(1) } : {},
      )
      // Nothing happened as far as the file is concerned: no "edited" mark left behind.
      if (this.clean) markSaved()
    }
  }
}
