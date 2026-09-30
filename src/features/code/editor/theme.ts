/**
 * CodeMirror look, built from the app's design tokens (CSS variables), so it follows the
 * light/dark theme without re-rendering. Style only through EditorView.theme: CodeMirror
 * injects unlayered CSS that would win over Tailwind utilities.
 */
import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const MONO = "var(--font-mono, ui-monospace, 'SF Mono', Menlo, Consolas, monospace)"
const SANS = "var(--font-sans, 'Inter Variable', ui-sans-serif, system-ui, sans-serif)"

export const highlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--le-fg)' },
  { tag: t.string, color: 'var(--le-accent-text)' },
  { tag: t.number, color: 'var(--le-warning)' },
  { tag: [t.bool, t.null], color: 'var(--le-label-precomp)' },
  { tag: [t.brace, t.squareBracket, t.separator, t.punctuation], color: 'var(--le-fg-subtle)' },
  { tag: t.invalid, color: 'var(--le-danger)' },
])

/** Editor chrome. `dark` selects CodeMirror's dark base styles for anything not overridden. */
export function editorTheme(dark: boolean) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: '12px',
        color: 'var(--le-fg)',
        backgroundColor: 'var(--le-surface-1)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: MONO,
        lineHeight: '18px',
        fontVariantLigatures: 'none',
      },
      '.cm-content': { padding: '8px 0 32px', caretColor: 'var(--le-fg)' },
      '.cm-line': { padding: '0 16px 0 4px' },
      '.cm-cursor, .cm-dropCursor': { borderLeft: '1.5px solid var(--le-fg)' },

      // Selection
      '.cm-selectionBackground': { background: 'var(--le-selected)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
        background: 'var(--le-selected-strong)',
      },
      '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--le-fg) 9%, transparent)' },
      '&.cm-focused .cm-matchingBracket': {
        backgroundColor: 'var(--le-accent-subtle)',
        outline: '1px solid color-mix(in srgb, var(--le-accent) 55%, transparent)',
        borderRadius: '2px',
      },
      '&.cm-focused .cm-nonmatchingBracket': {
        color: 'var(--le-danger)',
        backgroundColor: 'transparent',
      },

      // Active line only while editing, so a revealed-but-unfocused view stays calm.
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '&.cm-focused .cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--le-fg) 3.5%, transparent)',
      },

      // Gutters
      '.cm-gutters': {
        backgroundColor: 'var(--le-surface-1)',
        color: 'var(--le-fg-faint)',
        border: 'none',
        fontVariantNumeric: 'tabular-nums',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 12px', minWidth: '36px' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      '&.cm-focused .cm-activeLineGutter': { color: 'var(--le-fg-muted)' },
      '.cm-foldGutter .cm-gutterElement': {
        width: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--le-fg-subtle)',
        cursor: 'default',
      },
      // Open markers appear on gutter hover only; folded ones always show.
      '.cm-foldGutter .cm-le-fold-open': { opacity: '0', transition: 'opacity 120ms ease-out' },
      '.cm-gutters:hover .cm-foldGutter .cm-le-fold-open': { opacity: '1' },
      '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--le-fg)' },
      '.cm-le-fold-marker': { display: 'block' },
      '.cm-gutter-lint': { width: '12px' },
      '.cm-gutter-lint .cm-gutterElement': {
        padding: '0 0 0 6px',
        display: 'flex',
        alignItems: 'center',
      },
      '.cm-lint-marker': { width: '6px', height: '6px', borderRadius: '999px' },
      // CodeMirror draws markers with `content: url(svg)`; replace them with quiet dots.
      '.cm-lint-marker-error': { content: 'none', backgroundColor: 'var(--le-danger)' },
      '.cm-lint-marker-warning': { content: 'none', backgroundColor: 'var(--le-warning)' },

      // Folded code
      '.cm-foldPlaceholder': {
        backgroundColor: 'var(--le-surface-3)',
        border: 'none',
        borderRadius: '3px',
        color: 'var(--le-fg-muted)',
        padding: '0 5px',
        margin: '0 2px',
        fontFamily: SANS,
        fontSize: '11px',
        cursor: 'default',
        boxShadow: 'inset 0 0 0 1px var(--le-line-strong)',
      },
      '.cm-foldPlaceholder:hover': { color: 'var(--le-fg)', backgroundColor: 'var(--le-pressed)' },

      // Search
      '.cm-searchMatch': {
        backgroundColor: 'var(--le-warning-subtle)',
        outline: '1px solid color-mix(in srgb, var(--le-warning) 40%, transparent)',
        borderRadius: '2px',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--le-warning) 40%, transparent)',
        outline: '1px solid var(--le-warning)',
      },

      // Lint
      '.cm-lintRange-error': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--le-danger)',
        textDecorationSkipInk: 'none',
        textUnderlineOffset: '3px',
      },
      '.cm-lintRange-active': { backgroundColor: 'var(--le-danger-subtle)' },
      '.cm-lintPoint-error:after': { borderBottomColor: 'var(--le-danger)' },
      '.cm-lintPoint-warning:after': { borderBottomColor: 'var(--le-warning)' },
      '.cm-lintRange-warning': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--le-warning)',
        textUnderlineOffset: '3px',
      },

      // Panels (search is ours; "go to line" keeps CodeMirror's markup)
      '.cm-panels': { backgroundColor: 'var(--le-surface-1)', color: 'var(--le-fg)' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--le-line)' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--le-line)' },
      '.cm-panel': { fontFamily: SANS, fontSize: '12px' },
      '.cm-panel.cm-gotoLine': {
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      },
      '.cm-panel.cm-gotoLine label': {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: 'var(--le-fg-muted)',
      },
      '.cm-textfield': {
        height: '24px',
        padding: '0 8px',
        border: 'none',
        borderRadius: '4px',
        backgroundColor: 'var(--le-surface-2)',
        color: 'var(--le-fg)',
        fontFamily: SANS,
        fontSize: '12px',
        outline: 'none',
        boxShadow: 'inset 0 0 0 1px var(--le-line-strong)',
      },
      '.cm-textfield:focus': { boxShadow: 'inset 0 0 0 1px var(--le-accent)' },
      '.cm-button': {
        height: '24px',
        padding: '0 8px',
        border: 'none',
        borderRadius: '6px',
        backgroundImage: 'none',
        backgroundColor: 'var(--le-surface-2)',
        color: 'var(--le-fg)',
        fontFamily: SANS,
        fontSize: '12px',
        fontWeight: '500',
        boxShadow: 'inset 0 0 0 1px var(--le-line-strong)',
      },
      '.cm-button:hover': { backgroundColor: 'var(--le-surface-3)' },
      '.cm-panel button[name=close]': { color: 'var(--le-fg-subtle)' },

      // Tooltips (lint messages, folded-code hints)
      '.cm-tooltip': {
        backgroundColor: 'var(--le-surface-3)',
        color: 'var(--le-fg)',
        border: 'none',
        borderRadius: '6px',
        boxShadow: 'var(--le-shadow-popover)',
        fontFamily: SANS,
        fontSize: '11px',
        lineHeight: '16px',
        overflow: 'hidden',
      },
      '.cm-tooltip-lint': { padding: '0' },
      '.cm-diagnostic': { padding: '6px 10px', borderLeft: 'none' },
      '.cm-diagnostic-error': { borderLeft: 'none', boxShadow: 'inset 2px 0 0 var(--le-danger)' },
      '.cm-diagnostic-warning': {
        borderLeft: 'none',
        boxShadow: 'inset 2px 0 0 var(--le-warning)',
      },
      '.cm-diagnosticSource': { display: 'none' },

      // Reveal flash
      '.cm-le-flash': { animation: 'le-code-flash 1400ms ease-out forwards' },
      '@keyframes le-code-flash': {
        '0%': { backgroundColor: 'color-mix(in srgb, var(--le-accent) 28%, transparent)' },
        '100%': { backgroundColor: 'transparent' },
      },
    },
    { dark },
  )
}
