/**
 * Opening the Replace dialog (from the Customize page, the editor command or a dropped file).
 */
import type { NodePath } from '@/lottie/path'
import { selectNodes } from '@/store/document'
import { openDialog } from '@/store/ui'

export const REPLACE_DIALOG = 'customize.replace'

export interface ReplaceDialogProps {
  target: NodePath
  /** A file to start with (dropped on the page). */
  file?: File
}

/** Opens the Replace dialog for the element at `target`. */
export function openReplace(target: NodePath, file?: File): void {
  // Selected, the element is outlined in the preview while it is being replaced.
  selectNodes([target])
  openDialog(REPLACE_DIALOG, { target, file } satisfies ReplaceDialogProps)
}
