/**
 * The mounted timeline, as seen by commands (which run outside React). Null while the
 * timeline is not mounted; actions then fall back to document-only behaviour.
 */
import type { NodePath } from '@/lottie/path'
import type { FlatRow, RowsResult } from './model'

export interface TimelineRuntime {
  /** Current flattened rows. */
  rows(): RowsResult
  /** Scrolls a row into view. */
  revealRow(row: FlatRow): void
  /** Shows a layer's rows once an expansion requested just before has rendered. */
  revealExpanded(path: NodePath): void
  /** Scrolls horizontally so a root frame is visible. */
  ensureFrameVisible(frame: number): void
  zoomBy(factor: number): void
  zoomFit(): void
  /** Focuses the timeline (keyboard scope for timeline-only shortcuts). */
  focus(): void
  /** Focuses the rows (a visible keyboard focus: ↑/↓ then select layers). */
  focusRows(): void
}

let runtime: TimelineRuntime | null = null

export function setTimelineRuntime(next: TimelineRuntime | null): void {
  runtime = next
}

export function getTimelineRuntime(): TimelineRuntime | null {
  return runtime
}
