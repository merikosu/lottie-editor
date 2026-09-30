/**
 * Transient UI state of the themes feature (not persisted, not in the undo history). It belongs
 * to one document: opening another one resets it (selectors compare `docId`).
 */
import { create } from 'zustand'
import { useDocument } from '@/store/document'

export interface ThemesUiState {
  /** Document the state belongs to. */
  docId: string | null
  /** Theme edited in the Themes section and shown on the canvas (null: Default). */
  themeId: string | null
  /** Theme color whose name is being edited (right after it was made, F2, the menu). */
  renamingSlot: string | null
  /** Theme whose name is being edited; 'new' while a new theme is being named. */
  renamingTheme: string | null
  /** Bumped to ask the Themes section to scroll into view (commands, the Colors panel). */
  revealTick: number
}

export const useThemesUi = create<ThemesUiState>()(() => ({
  docId: null,
  themeId: null,
  renamingSlot: null,
  renamingTheme: null,
  revealTick: 0,
}))

const currentDocId = () => useDocument.getState().meta?.id ?? null

/** Updates the state of the open document (state of a previous document is dropped). */
export function setThemesUi(patch: Partial<Omit<ThemesUiState, 'docId' | 'revealTick'>>): void {
  const docId = currentDocId()
  useThemesUi.setState((s) =>
    s.docId === docId
      ? patch
      : { docId, themeId: null, renamingSlot: null, renamingTheme: null, ...patch },
  )
}

/** The state if it belongs to the open document, else the empty state. */
function scoped<T>(
  s: ThemesUiState,
  docId: string | null,
  pick: (s: ThemesUiState) => T,
  empty: T,
) {
  return docId !== null && s.docId === docId ? pick(s) : empty
}

/** Theme selected in the section (null: Default). Not checked against the package's themes. */
export function getSelectedThemeId(): string | null {
  return scoped(useThemesUi.getState(), currentDocId(), (s) => s.themeId, null)
}

export function useSelectedThemeId(): string | null {
  const docId = useDocument((s) => s.meta?.id ?? null)
  return useThemesUi((s) => scoped(s, docId, (x) => x.themeId, null))
}

export function useRenamingSlot(): string | null {
  const docId = useDocument((s) => s.meta?.id ?? null)
  return useThemesUi((s) => scoped(s, docId, (x) => x.renamingSlot, null))
}

export function useRenamingTheme(): string | null {
  const docId = useDocument((s) => s.meta?.id ?? null)
  return useThemesUi((s) => scoped(s, docId, (x) => x.renamingTheme, null))
}

/** Asks the Themes section to scroll into view. */
export function requestReveal(): void {
  useThemesUi.setState((s) => ({ revealTick: s.revealTick + 1 }))
}
