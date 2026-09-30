/**
 * CodeMirror configuration of the JSON view: extensions, keymaps, folding and the reveal
 * flash. Kept free of React; the session wires it to the stores.
 */
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state'
import {
  crosshairCursor,
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type DecorationSet,
  type KeyBinding,
  type Panel,
  type ViewUpdate,
} from '@codemirror/view'
import { formatBytes } from '@/lib/format'
import { editorTheme, highlightStyle } from './theme'

/** Marks transactions made by the editor itself (sync, apply, revert), not by typing. */
export const External = Annotation.define<boolean>()

export const themeCompartment = new Compartment()
export const phrasesCompartment = new Compartment()
export const historyCompartment = new Compartment()

/** Strings longer than this that start with "data:" are folded on load. */
export const LONG_DATA_URI = 256

/* -------------------------------------------------------------------------- */
/*                                   Folding                                  */
/* -------------------------------------------------------------------------- */

const CHEVRON = 'M4.5 3 7.5 6 4.5 9'

function foldMarker(open: boolean): HTMLElement {
  const span = document.createElement('span')
  span.className = `cm-le-fold-marker ${open ? 'cm-le-fold-open' : 'cm-le-fold-closed'}`
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('viewBox', '0 0 12 12')
  svg.setAttribute('aria-hidden', 'true')
  if (open) svg.style.transform = 'rotate(90deg)'
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', CHEVRON)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  span.appendChild(svg)
  return span
}

interface PlaceholderInfo {
  label: string
  title: string
}

let unfoldTitle = 'Unfold'

/** Localized tooltip of fold placeholders. */
export function setUnfoldTitle(title: string): void {
  unfoldTitle = title
}

/** Folded data URIs show their decoded size; other folds show an ellipsis. */
function preparePlaceholder(
  state: EditorState,
  range: { from: number; to: number },
): PlaceholderInfo {
  const closing = state.sliceDoc(range.to, range.to + 1)
  const line = state.doc.lineAt(range.from)
  const before = state.sliceDoc(line.from, range.from)
  if (closing === '"' && /"data:[^"]*$/.test(before)) {
    const bytes = Math.floor(((range.to - range.from) * 3) / 4)
    return { label: `… ${formatBytes(bytes)}`, title: unfoldTitle }
  }
  return { label: '…', title: unfoldTitle }
}

function placeholderDOM(
  _view: EditorView,
  onclick: (event: Event) => void,
  prepared: PlaceholderInfo,
): HTMLElement {
  const el = document.createElement('span')
  el.className = 'cm-foldPlaceholder'
  el.textContent = prepared.label
  el.title = prepared.title
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', prepared.title)
  el.addEventListener('click', onclick)
  return el
}

/* -------------------------------------------------------------------------- */
/*                                Reveal flash                                */
/* -------------------------------------------------------------------------- */

export const flashEffect = StateEffect.define<{ from: number; to: number } | null>()

const flashLine = Decoration.line({ class: 'cm-le-flash' })
/** Enough to cover any viewport; longer nodes only flash their beginning. */
const MAX_FLASH_LINES = 200

/** Briefly highlights the lines of a revealed node (cleared by a later `flashEffect.of(null)`). */
export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(flashEffect)) continue
      if (!e.value) {
        next = Decoration.none
        continue
      }
      const doc = tr.state.doc
      const first = doc.lineAt(e.value.from).number
      const last = Math.min(
        doc.lineAt(Math.max(e.value.from, e.value.to)).number,
        first + MAX_FLASH_LINES - 1,
      )
      const ranges = []
      for (let n = first; n <= last; n++) ranges.push(flashLine.range(doc.line(n).from))
      next = Decoration.set(ranges)
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

/* -------------------------------------------------------------------------- */
/*                                   Keymaps                                  */
/* -------------------------------------------------------------------------- */

export interface EditorCallbacks {
  onUpdate: (update: ViewUpdate) => void
  createSearchPanel: (view: EditorView) => Panel
  /** Runs the app-level undo/redo when the editor has no text history of its own. */
  undoDocument: () => void
  redoDocument: () => void
}

/**
 * ⌘Z first walks back through text edits, then continues into the document history (e.g.
 * undoing an Apply), so one shortcut works whether or not the editor has focus.
 */
function historyKeys(cb: EditorCallbacks): KeyBinding[] {
  const undoAny = (view: EditorView) => {
    if (undoDepth(view.state) > 0) return undo(view)
    cb.undoDocument()
    return true
  }
  const redoAny = (view: EditorView) => {
    if (redoDepth(view.state) > 0) return redo(view)
    cb.redoDocument()
    return true
  }
  return [
    { key: 'Mod-z', run: undoAny, preventDefault: true },
    { key: 'Mod-y', mac: 'Mod-Shift-z', run: redoAny, preventDefault: true },
    { linux: 'Ctrl-Shift-z', run: redoAny, preventDefault: true },
  ]
}

/** CodeMirror's defaults minus bindings the app handles itself (⌘↩ applies the edits). */
const editorDefaults = defaultKeymap.filter((b) => b.key !== 'Mod-Enter')
const historyDefaults = historyKeymap.filter((b) => !['Mod-z', 'Mod-y'].includes(b.key ?? ''))

/* -------------------------------------------------------------------------- */
/*                                 Extensions                                 */
/* -------------------------------------------------------------------------- */

export interface SetupOptions extends EditorCallbacks {
  dark: boolean
  phrases: Record<string, string>
  label: string
}

export function editorExtensions(opts: SetupOptions): Extension[] {
  return [
    lintGutter(),
    lineNumbers(),
    foldGutter({ markerDOM: foldMarker }),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    historyCompartment.of(history()),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(highlightStyle),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    codeFolding({ preparePlaceholder, placeholderDOM }),
    json(),
    search({ top: true, createPanel: opts.createSearchPanel }),
    flashField,
    EditorState.tabSize.of(2),
    indentUnit.of('  '),
    keymap.of([
      ...historyKeys(opts),
      ...closeBracketsKeymap,
      ...editorDefaults,
      ...searchKeymap,
      ...historyDefaults,
      ...foldKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    themeCompartment.of(editorTheme(opts.dark)),
    phrasesCompartment.of(EditorState.phrases.of(opts.phrases)),
    EditorView.contentAttributes.of({
      'aria-label': opts.label,
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
    }),
    EditorView.updateListener.of(opts.onUpdate),
  ]
}

/* -------------------------------------------------------------------------- */
/*                               Text utilities                               */
/* -------------------------------------------------------------------------- */

/** Index of the closing quote of the string starting at `open` (a quote), or -1. */
export function stringEnd(text: string, open: number): number {
  let from = open + 1
  for (;;) {
    const q = text.indexOf('"', from)
    if (q < 0) return -1
    let slashes = 0
    for (let b = q - 1; text.charCodeAt(b) === 92; b--) slashes++
    if (slashes % 2 === 0) return q
    from = q + 1
  }
}

/**
 * Ranges to fold so embedded images (multi-megabyte data URIs) collapse to their header
 * (`"data:image/png;base64,… 34 KB"`). `offset` is added to every position.
 */
export function dataUriFolds(text: string, offset = 0): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let i = 0
  for (;;) {
    i = text.indexOf('"data:', i)
    if (i < 0) break
    const end = stringEnd(text, i)
    if (end < 0) break
    if (end - i > LONG_DATA_URI) {
      const comma = text.indexOf(',', i)
      const headerEnd = comma > i && comma < end ? comma + 1 : i + 24
      out.push({ from: offset + headerEnd, to: offset + end })
    }
    i = end + 1
  }
  return out
}
