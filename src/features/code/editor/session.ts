/**
 * The JSON editor session: one CodeMirror view bound to the open document.
 *
 * - The text is a *view* of the document until the user types; then it becomes a local
 *   draft ("not applied") that only reaches the document through Apply (one undo step).
 * - Document changes are mirrored into the text as minimal diffs, so scroll position,
 *   folds and the cursor survive edits made elsewhere. With a local draft the text is never
 *   touched; a banner offers to reload instead.
 * - The session outlives the React component: switching between Canvas / JSON / Split
 *   keeps the draft, folds and scroll position.
 */
import {
  ensureSyntaxTree,
  foldEffect,
  foldedRanges,
  forceParsing,
  syntaxTree,
  unfoldEffect,
} from '@codemirror/language'
import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { openSearchPanel, setSearchQuery } from '@codemirror/search'
import { EditorSelection, EditorState, Transaction, type StateEffect } from '@codemirror/state'
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view'
import { history } from '@codemirror/commands'
import { create } from 'zustand'
import { resolveTheme } from '@/app/theme'
import { runCommand } from '@/commands/registry'
import { toast } from '@/components/ui'
import { getT } from '@/i18n'
import { fromObject } from '@/lottie/document'
import { pathEquals, pathKey, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { getDoc, primaryNode, replaceDoc, useDocument, type Selection } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { diffText, formatJson, utf8Length, type TextChange } from '../format'
import { findJsonError, findPathRange, type PathRange } from '../json-scan'
import { pathAtPosition, pathRangeInTree } from '../json-tree'
import { reconcile } from '../reconcile'
import {
  INITIAL_STATUS,
  setCodeController,
  setCodeStatus,
  takePendingReveal,
  useCodePrefs,
  useCodeStatus,
  type CodeController,
  type CodeError,
  type RevealOptions,
} from '../store'
import { lottieShapeIssue } from '../validate'
import {
  dataUriFolds,
  editorExtensions,
  External,
  flashEffect,
  historyCompartment,
  phrasesCompartment,
  setUnfoldTitle,
  themeCompartment,
} from './setup'
import { editorTheme } from './theme'

/** Texts up to this length are validated quickly after typing. */
const SMALL_TEXT = 300_000
/** Minified size above which the user confirms before the JSON is shown. */
const LARGE_DOC_BYTES = 12 * 1024 * 1024

/** DOM of CodeMirror's search panel, where React renders our own search UI. */
export const useSearchPanel = create<{ dom: HTMLElement | null; version: number }>()(() => ({
  dom: null,
  version: 0,
}))

type ParseResult = { ok: true; value: unknown } | { ok: false; error: CodeError }

function isDark(): boolean {
  return resolveTheme(usePrefs.getState().theme) === 'dark'
}

class JsonEditorSession {
  private view: EditorView | null = null
  private docId: string | null = null
  /** Document the base text was produced from. */
  private baseDoc: Animation | null = null
  /** Canonical text of `baseDoc` (what the editor shows while there is no draft). */
  private baseText = ''
  private baseBytes = 0
  private saved: { state: EditorState; scroll: StateEffect<unknown> } | null = null
  /** Set by typing; cleared when the text is known to equal the base again. */
  private userEdited = false
  private confirmedLarge = new Set<string>()
  private disposers: (() => void)[] = []
  private timers = { sync: 0, validate: 0, flash: 0, notice: 0, cursor: 0, search: 0 }
  private lastFollowed: string | null = null
  /** Selection changes caused by the editor itself must not scroll it (follow mode). */
  private selectingFromEditor = false
  /** Set while Apply replaces the document (its own change is not "outside"). */
  private applying = false
  /** Last reveal: its scroll is applied at the next measure, so a remount must redo it. */
  private lastReveal: { pos: number; at: number } | null = null

  /* ------------------------------ Lifecycle ------------------------------- */

  mount(host: HTMLElement): void {
    const { doc, meta } = useDocument.getState()
    if (!doc || !meta) return
    if (this.docId !== meta.id) this.resetFor(meta.id)

    let state: EditorState
    let scrollTo: StateEffect<unknown> | undefined
    let fresh = false
    let gated = false
    if (this.saved) {
      state = this.saved.state
      scrollTo = this.saved.scroll
      this.saved = null
    } else {
      fresh = true
      const large = this.largeSize(doc, meta.id, meta.sourceSize)
      gated = large !== null
      if (large !== null) {
        this.setBase(null, '')
        setCodeStatus({ largeDoc: large })
      } else {
        this.setBase(doc, formatJson(doc))
      }
      state = this.createState(this.baseText)
    }

    this.view = new EditorView({ state, parent: host, scrollTo })
    this.refreshConfig()
    this.subscribe()
    setCodeController(this.controller)
    if (gated) return
    if (fresh) this.foldDataUris(this.baseText, 0)
    setCodeStatus({
      ready: true,
      lines: this.view.state.doc.lines,
      bytes: this.userEdited ? useCodeStatus.getState().bytes : this.baseBytes,
    })
    this.syncNow()
    this.updateCursor()
    this.consumePendingReveal()
  }

  unmount(): void {
    const view = this.view
    if (!view) return
    for (const d of this.disposers) d()
    this.disposers = []
    cancelAnimationFrame(this.timers.cursor)
    cancelAnimationFrame(this.timers.search)
    for (const key of ['sync', 'validate', 'flash', 'notice'] as const)
      clearTimeout(this.timers[key])
    this.timers = { sync: 0, validate: 0, flash: 0, notice: 0, cursor: 0, search: 0 }
    // A gated (large, not yet shown) document has nothing worth keeping.
    if (this.baseDoc || this.userEdited) {
      const recent = this.lastReveal && performance.now() - this.lastReveal.at < 1000
      const scroll = recent
        ? EditorView.scrollIntoView(this.lastReveal!.pos, { y: 'start', yMargin: 56 })
        : view.scrollSnapshot()
      this.saved = { state: view.state, scroll }
    }
    view.destroy()
    this.view = null
    setCodeController(null)
    setCodeStatus({ ready: false, notice: null })
  }

  private resetFor(docId: string): void {
    this.docId = docId
    this.saved = null
    this.userEdited = false
    this.lastFollowed = null
    this.setBase(null, '')
    useCodeStatus.setState(INITIAL_STATUS)
  }

  private setBase(
    doc: Animation | null,
    text: string,
    change?: TextChange | null,
    previous?: string,
  ): void {
    this.baseDoc = doc
    if (change && previous !== undefined) {
      // Incremental byte count: only the replaced range changes.
      this.baseBytes +=
        utf8Length(change.insert) - utf8Length(previous.slice(change.from, change.to))
    } else {
      this.baseBytes = utf8Length(text)
    }
    this.baseText = text
  }

  private createState(text: string): EditorState {
    const t = getT()
    return EditorState.create({
      doc: text,
      extensions: editorExtensions({
        dark: isDark(),
        phrases: t.code.phrases,
        label: t.code.title,
        onUpdate: (u) => this.onUpdate(u),
        createSearchPanel: (view) => this.createSearchPanel(view),
        undoDocument: () => void runCommand('edit.undo'),
        redoDocument: () => void runCommand('edit.redo'),
      }),
    })
  }

  private refreshConfig(): void {
    const view = this.view
    if (!view) return
    const t = getT()
    setUnfoldTitle(t.code.unfold)
    view.dispatch({
      effects: [
        themeCompartment.reconfigure(editorTheme(isDark())),
        phrasesCompartment.reconfigure(EditorState.phrases.of(t.code.phrases)),
      ],
    })
  }

  private subscribe(): void {
    this.disposers.push(
      useDocument.subscribe(
        (s) => s.doc,
        () => this.onDocChanged(),
      ),
      useDocument.subscribe(
        (s) => s.meta?.id,
        (id) => this.onDocSwitched(id ?? null),
      ),
      useDocument.subscribe(
        (s) => s.selection,
        (sel) => this.onSelection(sel),
      ),
      usePrefs.subscribe((s, prev) => {
        if (s.theme !== prev.theme || s.language !== prev.language) this.refreshConfig()
      }),
      useCodePrefs.subscribe((s, prev) => {
        if (s.followSelection && !prev.followSelection) {
          this.lastFollowed = null
          this.onSelection(useDocument.getState().selection)
        }
      }),
    )
  }

  /* --------------------------- Large documents ---------------------------- */

  /** Minified size when the document needs confirmation before being shown, else null. */
  private largeSize(doc: Animation, docId: string, sourceSize?: number): number | null {
    if (this.confirmedLarge.has(docId)) return null
    if (sourceSize !== undefined && sourceSize < LARGE_DOC_BYTES / 3) return null
    const size = JSON.stringify(doc).length
    return size > LARGE_DOC_BYTES ? size : null
  }

  private openLarge(): void {
    const view = this.view
    const doc = getDoc()
    if (!view || !doc || !this.docId) return
    this.confirmedLarge.add(this.docId)
    // Let the notice show its busy state before the (long) formatting blocks the thread.
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (!this.view) return
        const text = formatJson(doc)
        this.setBase(doc, text)
        this.view.setState(this.createState(text))
        this.refreshConfig()
        this.foldDataUris(text, 0)
        setCodeStatus({
          largeDoc: null,
          ready: true,
          lines: this.view.state.doc.lines,
          bytes: this.baseBytes,
        })
        this.consumePendingReveal()
      }, 16),
    )
  }

  /* -------------------------------- Sync ---------------------------------- */

  /** True when the editor text differs from the document's canonical text. */
  private isDirty(): boolean {
    const view = this.view
    if (!view || !this.userEdited) return false
    if (
      view.state.doc.length === this.baseText.length &&
      view.state.doc.toString() === this.baseText
    ) {
      this.userEdited = false
      return false
    }
    return true
  }

  private onDocChanged(): void {
    const doc = getDoc()
    if (
      this.applying ||
      !doc ||
      !this.view ||
      doc === this.baseDoc ||
      useCodeStatus.getState().largeDoc !== null
    )
      return
    if (this.userEdited) {
      // Already flagged: skip the full-text comparison on every frame of a drag elsewhere.
      if (useCodeStatus.getState().stale) return
      if (this.isDirty()) {
        setCodeStatus({ stale: true, staleDismissed: false })
        return
      }
    }
    clearTimeout(this.timers.sync)
    // Batch bursts (drags, scrubbing) and keep big documents from formatting every frame.
    const delay = this.baseText.length < SMALL_TEXT ? 50 : 250
    this.timers.sync = window.setTimeout(() => this.syncNow(), delay)
  }

  /** Brings the text up to date with the document (no-op with a local draft). */
  private syncNow(): void {
    clearTimeout(this.timers.sync)
    const view = this.view
    const doc = getDoc()
    if (!view || !doc || doc === this.baseDoc || this.baseDoc === null) return
    if (this.isDirty()) {
      setCodeStatus({ stale: true, staleDismissed: false })
      return
    }
    const previous = this.baseText
    const text = formatJson(doc)
    const change = diffText(previous, text)
    this.setBase(doc, text, change, previous)
    if (change) {
      view.dispatch({
        changes: change,
        annotations: [
          External.of(true),
          Transaction.addToHistory.of(false),
          Transaction.remote.of(true),
        ],
      })
      this.foldDataUris(change.insert, change.from)
    }
    setCodeStatus({ lines: view.state.doc.lines, bytes: this.baseBytes, stale: false })
  }

  private onDocSwitched(id: string | null): void {
    const view = this.view
    const doc = getDoc()
    if (!view || !id || id === this.docId || !doc) return
    this.resetFor(id)
    const large = this.largeSize(doc, id, useDocument.getState().meta?.sourceSize)
    if (large !== null) {
      view.setState(this.createState(''))
      this.refreshConfig()
      setCodeStatus({ largeDoc: large })
      return
    }
    this.setBase(doc, formatJson(doc))
    view.setState(this.createState(this.baseText))
    this.refreshConfig()
    this.foldDataUris(this.baseText, 0)
    setCodeStatus({ ready: true, lines: view.state.doc.lines, bytes: this.baseBytes })
    this.updateCursor()
  }

  /** Replaces the whole text with the document's canonical text (no undo, no draft). */
  private resetText(doc: Animation): void {
    const view = this.view
    if (!view) return
    const current = view.state.doc.toString()
    const text = formatJson(doc)
    const change = diffText(current, text)
    this.setBase(doc, text)
    view.dispatch({
      changes: change ?? undefined,
      effects: [historyCompartment.reconfigure([])],
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    })
    // Re-adding the history extension starts it empty: ⌘Z now continues into document history.
    view.dispatch({ effects: historyCompartment.reconfigure(history()) })
    view.dispatch(setDiagnostics(view.state, []))
    if (change) this.foldDataUris(change.insert, change.from)
    this.userEdited = false
    setCodeStatus({
      dirty: false,
      stale: false,
      staleDismissed: false,
      error: null,
      lines: view.state.doc.lines,
      bytes: this.baseBytes,
    })
  }

  /* ------------------------------ Validation ------------------------------ */

  private onUpdate(u: ViewUpdate): void {
    if (u.docChanged) {
      const byUser = u.transactions.some((tr) => tr.docChanged && !tr.annotation(External))
      if (byUser) {
        this.userEdited = true
        if (!useCodeStatus.getState().dirty) setCodeStatus({ dirty: true })
        clearTimeout(this.timers.validate)
        const delay = u.state.doc.length < SMALL_TEXT ? 160 : 600
        this.timers.validate = window.setTimeout(() => this.validate(), delay)
      }
    }
    const treeChanged = syntaxTree(u.state) !== syntaxTree(u.startState)
    if (
      u.docChanged ||
      u.selectionSet ||
      (treeChanged && useCodeStatus.getState().cursorPath === null)
    ) {
      this.scheduleCursor()
    }
  }

  private parse(text: string): ParseResult {
    const view = this.view!
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (e) {
      const found = findJsonError(text)
      const pos = found?.pos ?? 0
      // Zero-length errors ("comma missing here") are drawn as a point by the linter.
      const end =
        found && found.end === found.pos
          ? pos
          : Math.min(text.length, Math.max(found?.end ?? pos + 1, pos + 1))
      const code = found?.code ?? 'unexpected-token'
      const detail = found?.found ?? (e instanceof Error ? e.message : '')
      return {
        ok: false,
        error: { kind: 'json', code, found: detail, pos, end, ...this.lineCol(view.state, pos) },
      }
    }
    const issue = lottieShapeIssue(value)
    if (issue) {
      const range = this.locate(issue.path, text)
      const pos = range ? (range.keyFrom ?? range.from) : 0
      const end = range
        ? Math.min(range.to, view.state.doc.lineAt(pos).to)
        : Math.min(1, text.length)
      return {
        ok: false,
        error: {
          kind: 'lottie',
          code: issue.code,
          path: issue.path,
          pos,
          end: Math.max(end, pos + 1),
          ...this.lineCol(view.state, pos),
        },
      }
    }
    return { ok: true, value }
  }

  private lineCol(state: EditorState, pos: number): { line: number; col: number } {
    const line = state.doc.lineAt(Math.min(pos, state.doc.length))
    return { line: line.number, col: pos - line.from + 1 }
  }

  private errorMessage(error: CodeError): string {
    const t = getT()
    return error.kind === 'json'
      ? t.code.jsonErrors[error.code](error.found)
      : t.code.shapeErrors[error.code]
  }

  private validate(): void {
    clearTimeout(this.timers.validate)
    const view = this.view
    if (!view) return
    const text = view.state.doc.toString()
    if (text === this.baseText) {
      this.userEdited = false
      view.dispatch(setDiagnostics(view.state, []))
      setCodeStatus({
        dirty: false,
        error: null,
        stale: false,
        staleDismissed: false,
        bytes: this.baseBytes,
      })
      // The document may have changed while the draft existed.
      if (getDoc() !== this.baseDoc) this.syncNow()
      return
    }
    const result = this.parse(text)
    const error = result.ok ? null : result.error
    const diagnostics: Diagnostic[] = error
      ? [
          {
            from: error.pos,
            to: Math.min(error.end, view.state.doc.length),
            severity: 'error',
            message: this.errorMessage(error),
          },
        ]
      : []
    view.dispatch(setDiagnostics(view.state, diagnostics))
    setCodeStatus({ dirty: true, error, bytes: utf8Length(text) })
  }

  /* ------------------------------- Actions -------------------------------- */

  private apply(): boolean {
    const view = this.view
    const current = getDoc()
    if (!view || !current) return false
    clearTimeout(this.timers.validate)
    const text = view.state.doc.toString()
    if (text === this.baseText && current === this.baseDoc) {
      this.validate()
      return false
    }
    const result = this.parse(text)
    if (!result.ok) {
      view.dispatch(
        setDiagnostics(view.state, [
          {
            from: result.error.pos,
            to: result.error.end,
            severity: 'error',
            message: this.errorMessage(result.error),
          },
        ]),
      )
      setCodeStatus({ error: result.error, dirty: true })
      this.jumpTo(result.error.pos)
      return false
    }
    const before = result.value as Record<string, unknown>
    const snapshot = {
      fr: before.fr,
      ip: before.ip,
      op: before.op,
      w: before.w,
      h: before.h,
      layers: before.layers,
    }
    const { animation } = fromObject(result.value)
    const next = reconcile(current, animation)
    this.applying = true
    try {
      if (next !== current) replaceDoc(getT().code.historyApply, next)
    } finally {
      this.applying = false
    }
    this.resetText(getDoc() ?? next)
    this.reportRepairs(snapshot, animation)
    return true
  }

  /** Tells the user which fields Apply had to repair (translated, unlike the parser's notes). */
  private reportRepairs(before: Record<string, unknown>, after: Animation): void {
    const t = getT()
    const keys = ['fr', 'ip', 'op', 'w', 'h'] as const
    const fixed: string[] = keys.filter((k) => before[k] !== after[k]).map((k) => t.code.repairs[k])
    if (before.layers !== after.layers) fixed.push(t.code.repairs.layers)
    if (fixed.length)
      toast.warning(t.code.appliedWithRepairs(fixed.length), { description: fixed.join('. ') })
  }

  private revert(): void {
    const doc = getDoc()
    if (doc) this.resetText(doc)
  }

  private format(): boolean {
    const view = this.view
    if (!view) return false
    const text = view.state.doc.toString()
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      this.validate()
      const error = useCodeStatus.getState().error
      if (error) this.jumpTo(error.pos)
      return false
    }
    const change = diffText(text, formatJson(value))
    if (change) view.dispatch({ changes: change, userEvent: 'input.format' })
    return true
  }

  private jumpTo(pos: number): void {
    const view = this.view
    if (!view) return
    const at = Math.min(pos, view.state.doc.length)
    view.dispatch({
      selection: EditorSelection.cursor(at),
      effects: EditorView.scrollIntoView(at, { y: 'center' }),
    })
    view.focus()
  }

  /* ------------------------------- Reveal --------------------------------- */

  /** Finds the range of a path: syntax tree first (tolerates errors), text scan otherwise. */
  private locate(path: NodePath, knownText?: string): PathRange | null {
    const view = this.view
    if (!view) return null
    const state = view.state
    const read = (from: number, to: number) => state.sliceDoc(from, to)
    const viaTree = pathRangeInTree(syntaxTree(state), state.doc.length, read, path)
    if (viaTree !== undefined) return viaTree
    // Small and medium documents parse fully within a few frames.
    const full = ensureSyntaxTree(state, state.doc.length, 40)
    if (full) {
      const r = pathRangeInTree(full, state.doc.length, read, path)
      if (r !== undefined) return r
    }
    const text = knownText ?? (this.userEdited ? state.doc.toString() : this.baseText)
    return findPathRange(text, path)
  }

  private reveal(path: NodePath, opts: RevealOptions = {}): boolean {
    const view = this.view
    if (!view || useCodeStatus.getState().largeDoc !== null) return false
    if (!this.isDirty()) this.syncNow()
    const range = this.locate(path)
    if (!range) {
      this.showNotice(getT().code.notFound)
      return false
    }
    const anchor = range.keyFrom ?? range.from
    const effects: StateEffect<unknown>[] = [
      EditorView.scrollIntoView(anchor, { y: 'start', yMargin: 56 }),
      flashEffect.of({ from: anchor, to: range.to }),
    ]
    foldedRanges(view.state).between(anchor, anchor, (from, to) => {
      if (from <= anchor && to >= anchor) effects.push(unfoldEffect.of({ from, to }))
    })
    view.dispatch({
      selection: EditorSelection.cursor(anchor),
      effects,
      annotations: External.of(true),
    })
    this.lastReveal = { pos: anchor, at: performance.now() }
    // Highlight the destination right away instead of waiting for the background parser.
    forceParsing(view, Math.min(view.state.doc.length, range.to + 2000), 50)
    if (opts.focus) view.focus()
    clearTimeout(this.timers.flash)
    this.timers.flash = window.setTimeout(
      () => this.view?.dispatch({ effects: flashEffect.of(null) }),
      1500,
    )
    return true
  }

  private consumePendingReveal(): void {
    const pending = takePendingReveal()
    if (pending) this.reveal(pending.path, { focus: pending.focus })
    else if (useCodePrefs.getState().followSelection)
      this.onSelection(useDocument.getState().selection)
  }

  private onSelection(sel: Selection): void {
    if (!useCodePrefs.getState().followSelection || !this.view || !useCodeStatus.getState().ready)
      return
    if (this.selectingFromEditor) return
    const path = primaryNode(sel)
    const key = path ? pathKey(path) : null
    if (!path || key === this.lastFollowed) return
    this.lastFollowed = key
    this.reveal(path, { focus: false })
  }

  /** Selects a node in the app from the editor (breadcrumb), without scrolling back. */
  selectFromEditor(path: NodePath, select: (path: NodePath) => void): void {
    this.selectingFromEditor = true
    try {
      select(path)
      this.lastFollowed = pathKey(path)
    } finally {
      this.selectingFromEditor = false
    }
  }

  /** Moves the cursor to the start of a path's value (breadcrumb navigation). */
  goTo(path: NodePath): void {
    const view = this.view
    if (!view) return
    const range = this.locate(path)
    if (!range) return
    const at = range.keyFrom ?? range.from
    view.dispatch({
      selection: EditorSelection.cursor(at),
      effects: EditorView.scrollIntoView(at, { y: 'nearest', yMargin: 48 }),
    })
    view.focus()
  }

  private showNotice(notice: string): void {
    setCodeStatus({ notice })
    clearTimeout(this.timers.notice)
    this.timers.notice = window.setTimeout(() => setCodeStatus({ notice: null }), 2500)
  }

  /* ------------------------------- Cursor --------------------------------- */

  private scheduleCursor(): void {
    if (this.timers.cursor) return
    this.timers.cursor = requestAnimationFrame(() => {
      this.timers.cursor = 0
      this.updateCursor()
    })
  }

  private updateCursor(): void {
    const view = this.view
    if (!view) return
    const { state } = view
    const pos = state.selection.main.head
    const { line, col } = this.lineCol(state, pos)
    const tree = syntaxTree(state)
    let path: NodePath | null = null
    if (tree.length >= Math.min(state.doc.length, pos + 1)) {
      path = pathAtPosition(tree, (from, to) => state.sliceDoc(from, to), pos)
    }
    const s = useCodeStatus.getState()
    const cursorPath = path && s.cursorPath && pathEquals(path, s.cursorPath) ? s.cursorPath : path
    if (
      s.line !== line ||
      s.col !== col ||
      s.cursorPath !== cursorPath ||
      s.lines !== state.doc.lines
    ) {
      setCodeStatus({ line, col, cursorPath, lines: state.doc.lines })
    }
  }

  /* -------------------------------- Folds --------------------------------- */

  private foldDataUris(text: string, offset: number): void {
    const view = this.view
    if (!view) return
    const folds = dataUriFolds(text, offset)
    if (folds.length) view.dispatch({ effects: folds.map((f) => foldEffect.of(f)) })
  }

  /* -------------------------------- Search -------------------------------- */

  private createSearchPanel(_view: EditorView): Panel {
    const dom = document.createElement('div')
    dom.className = 'cm-le-search'
    const bump = () => {
      if (this.timers.search) return
      this.timers.search = requestAnimationFrame(() => {
        this.timers.search = 0
        useSearchPanel.setState((s) => ({ version: s.version + 1 }))
      })
    }
    return {
      dom,
      top: true,
      mount: () => useSearchPanel.setState((s) => ({ dom, version: s.version + 1 })),
      update: (u) => {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))
        )
          bump()
      },
      destroy: () => {
        if (useSearchPanel.getState().dom === dom) useSearchPanel.setState({ dom: null })
      },
    }
  }

  /** The live view (search panel, tests). */
  get editorView(): EditorView | null {
    return this.view
  }

  /* ------------------------------ Controller ------------------------------ */

  private readonly controller: CodeController = {
    apply: () => this.apply(),
    revert: () => this.revert(),
    format: () => this.format(),
    reveal: (path, opts) => this.reveal(path, opts),
    jumpTo: (pos) => this.jumpTo(pos),
    openSearch: () => {
      if (this.view) openSearchPanel(this.view)
    },
    focus: () => this.view?.focus(),
    openLarge: () => this.openLarge(),
    hasFocus: () => {
      const view = this.view
      if (!view) return false
      const active = document.activeElement
      return view.hasFocus || (!!active && view.dom.contains(active))
    },
  }

  /** Keeps the draft but hides the "changed outside" banner. */
  dismissStale(): void {
    setCodeStatus({ staleDismissed: true })
  }
}

export const session = new JsonEditorSession()
