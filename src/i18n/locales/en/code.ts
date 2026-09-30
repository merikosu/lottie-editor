/** Strings of the "code" feature. Keep keys in sync with ../ru/code.ts (type-checked). */
import { pluralEn } from '../../plural'

const code = {
  title: 'JSON',
  loading: 'Loading the JSON editor…',

  /* Toolbar */
  apply: 'Apply',
  applyHint: 'Apply your edits to the animation',
  applyBlocked: 'Fix the error before applying',
  revert: 'Revert',
  revertHint: 'Discard your edits and show the animation’s JSON',
  formatHint: 'Format the JSON',
  formatBlocked: 'Fix the syntax error to format',
  followSelectionOn: 'Following the selection: selecting a layer or shape scrolls the JSON to it',
  followSelectionOff: 'Scroll the JSON to the selected layer or shape',
  find: 'Find',
  notApplied: 'Not applied',
  notAppliedHint: 'Your edits are not part of the animation until you apply them',
  lines: (n: number) => pluralEn(n, 'line', 'lines'),
  errorAt: (line: number, col: number) => `Line ${line}:${col}`,
  errorJump: 'Go to the error',

  /* Banner */
  changedOutside: 'The animation changed outside the JSON editor.',
  changedOutsideHint:
    'Reload to see the current animation, or keep your edits and apply them over it.',
  reload: 'Reload',
  keepEditing: 'Keep my edits',

  /* Large documents */
  largeTitle: 'This animation is large',
  largeDescription: (size: string) =>
    `Its JSON is ${size}. Showing it as text can take a few seconds.`,
  largeOpen: 'Show JSON',

  /* Breadcrumb and cursor */
  root: 'Document',
  pathLabel: 'JSON path at the cursor',
  position: (line: number, col: number) => `Ln ${line}, Col ${col}`,
  copyPath: 'Copy path',
  selectNode: (name: string) => `Select “${name}”`,
  notFound: 'Not found in the edited JSON',
  unfold: 'Unfold',

  /* History and results */
  historyApply: 'Edit JSON',
  appliedWithRepairs: (n: number) =>
    `Applied with ${pluralEn(n, 'automatic fix', 'automatic fixes')}`,
  repairs: {
    fr: 'Invalid frame rate replaced with 30 fps',
    ip: 'Missing in point set to 0',
    op: 'Invalid out point repaired',
    w: 'Invalid width replaced with 512',
    h: 'Invalid height replaced with 512',
    layers: 'Missing layers list created',
  },

  /* Errors */
  jsonErrors: {
    empty: () => 'The document is empty',
    'unexpected-end': () => 'The JSON ends too early — a bracket or quote is not closed',
    'unexpected-token': (found: string) => `Unexpected “${found}”`,
    'expected-property': () => 'Expected a property name in double quotes',
    'trailing-comma': () => 'Remove the comma before the closing bracket',
    'expected-colon': () => 'Expected “:” after the property name',
    'expected-comma-object': () => 'Expected “,” or “}” after the value',
    'expected-comma-array': () => 'Expected “,” or “]” after the value',
    'unterminated-string': () => 'The string is not closed — a quote is missing',
    'bad-escape': (found: string) => `Invalid escape sequence “${found}”`,
    'control-character': () => 'Tabs and other control characters must be escaped in strings',
    'bad-number': (found: string) => `Invalid number “${found}”`,
    'bad-literal': (found: string) => `Unknown value “${found}” — use true, false or null`,
    'trailing-content': () => 'Unexpected text after the end of the JSON',
    comment: () => 'Comments are not allowed in JSON',
  },
  shapeErrors: {
    'not-object': 'The JSON must be an object to be a Lottie animation',
    'no-layers': 'Not a Lottie animation: the “layers” list is missing',
    'no-dimensions': 'Not a Lottie animation: “w”, “h”, “fr” and “op” are all missing',
    'layer-not-object': 'Each layer must be an object',
    'layer-type': 'The layer type “ty” must be a number',
    'layer-transform': 'The layer transform “ks” is missing',
    'assets-not-array': '“assets” must be a list',
    'asset-not-object': 'Each asset must be an object',
    'asset-id': 'Each asset needs an “id”',
    'precomp-layers': 'The precomposition’s “layers” must be a list',
    'fonts-list': '“fonts.list” must be a list',
    'markers-not-array': '“markers” must be a list',
  },

  /* Search panel */
  search: {
    find: 'Find',
    replace: 'Replace',
    matchCase: 'Match case',
    regexp: 'Use regular expression',
    wholeWord: 'Match whole word',
    previous: 'Previous match',
    next: 'Next match',
    replaceOne: 'Replace',
    replaceAll: 'Replace all',
    toggleReplace: 'Toggle replace',
    close: 'Close',
    noResults: 'No results',
    invalid: 'Invalid expression',
    count: (index: number, total: number) => `${index} of ${total}`,
    matches: (n: number) => pluralEn(n, 'match', 'matches'),
    manyMatches: (n: number) => `${n}+ matches`,
  },

  /* Commands */
  commands: {
    apply: 'Apply JSON edits',
    format: 'Format JSON',
    revert: 'Revert JSON edits',
    followSelection: 'Follow selection in JSON',
    revealInCode: 'Show in JSON',
    find: 'Find in JSON',
  },

  /** CodeMirror's built-in phrases (go to line, folding, lint). */
  phrases: {
    'Go to line': 'Go to line',
    go: 'go',
    'Folded lines': 'Folded lines',
    'Unfolded lines': 'Unfolded lines',
    'Fold line': 'Fold line',
    'Unfold line': 'Unfold line',
    'folded code': 'folded code',
    unfold: 'unfold',
    to: 'to',
    Diagnostics: 'Diagnostics',
    'No diagnostics': 'No diagnostics',
    'Control character': 'Control character',
    'Selection deleted': 'Selection deleted',
    'current match': 'current match',
    'on line': 'on line',
    'replaced $ matches': 'replaced $ matches',
    'replaced match on line $': 'replaced match on line $',
  } as Record<string, string>,
}

export default code
