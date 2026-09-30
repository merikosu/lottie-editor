/**
 * Why a command is unavailable, when that can be told reliably. Commands only expose
 * `enabled()`, so the reason is inferred from the editor state; when the inference would be
 * a guess, no reason is shown (a wrong hint is worse than none).
 */
import type { CommandCategory } from '@/commands/registry'
import type { Dict } from '@/i18n'

export interface ReasonContext {
  hasDocument: boolean
  hasNodes: boolean
  hasKeyframes: boolean
  hasWorkArea: boolean
}

type Reasons = Dict['workspace']['palette']['reasons']

/** Commands that never need a document (their disabled state has another cause). */
const DOCUMENT_FREE = new Set([
  'file.new',
  'file.open',
  'file.openUrl',
  'file.samples',
  'file.clearRecents',
])
/** Page switching and the Customize/Optimizer pages' own commands: their causes are their own. */
const OWN_CAUSES = /^(?:app|customize|optimizer)\./

const SELECTION_EDITS = new Set(['edit.delete', 'edit.duplicate', 'edit.copy', 'edit.cut'])

/**
 * Explains a disabled command. Returns undefined when the cause is not known for sure.
 * Call it only for commands whose `enabled()` returned false.
 */
export function disabledReason(
  cmd: { id: string; category: CommandCategory },
  ctx: ReasonContext,
  t: Dict,
): string | undefined {
  const r: Reasons = t.workspace.palette.reasons
  const { id } = cmd
  if (id === 'file.clearRecents') return r.noRecents
  if (!ctx.hasDocument) {
    return DOCUMENT_FREE.has(id) || OWN_CAUSES.test(id) || cmd.category === 'help'
      ? undefined
      : r.noDocument
  }
  if (id === 'edit.undo') return t.app.history.nothingToUndo
  if (id === 'edit.redo') return t.app.history.nothingToRedo
  if (id === 'file.revert') return r.noChanges
  if (id === 'file.switchAnimation') return r.oneAnimation
  if (id === 'playback.clearWorkArea' || id === 'anim.trim')
    return ctx.hasWorkArea ? undefined : r.noWorkArea
  if (id.startsWith('keyframes.')) return ctx.hasKeyframes ? undefined : r.selectKeyframes
  if (id === 'view.zoomSelection') return ctx.hasNodes ? undefined : r.selectLayer
  if (SELECTION_EDITS.has(id))
    return ctx.hasNodes || ctx.hasKeyframes ? undefined : r.nothingSelected
  if (cmd.category === 'layer') return ctx.hasNodes ? undefined : r.selectLayer
  return undefined
}
