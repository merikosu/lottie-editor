/** Geometry of the layer tree (rows are absolutely positioned for virtualization). */

export const ROW_HEIGHT = 28
/** Horizontal step per tree level. */
export const INDENT = 12
/** Space above the first and below the last row. */
export const TREE_PAD = 4

/** X of a row's chevron column at `depth` (the row highlight is inset by 6px on each side). */
export function contentLeft(depth: number): number {
  return 14 + depth * INDENT
}

/** Y of the top edge of row `index` inside the scroll content. */
export function rowTop(index: number): number {
  return TREE_PAD + index * ROW_HEIGHT
}
