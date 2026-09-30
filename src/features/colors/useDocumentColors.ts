import { useShallow } from 'zustand/react/shallow'
import { documentPalette } from '@/lottie/colors'
import { useDocument } from '@/store/document'

const NONE: string[] = []

/**
 * Unique colors used in the current document as lowercase hex strings (#rrggbb),
 * most used first. Used for swatches in color pickers.
 *
 * Cheap: the palette is cached per document version and only layers changed by an edit are
 * rescanned. Callers re-render only when the palette itself changes, not on every edit (every
 * color field in the inspector uses this while values are scrubbed).
 */
export function useDocumentColors(): string[] {
  return useDocument(useShallow((s) => (s.doc ? documentPalette(s.doc) : NONE)))
}
