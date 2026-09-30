import type en from '../en/code'
import { pluralRu } from '../../plural'

const code: typeof en = {
  title: 'JSON',
  loading: 'Загрузка редактора JSON…',

  /* Toolbar */
  apply: 'Применить',
  applyHint: 'Применить правки к анимации',
  applyBlocked: 'Исправьте ошибку, чтобы применить',
  revert: 'Сбросить',
  revertHint: 'Сбросить правки и показать JSON анимации',
  formatHint: 'Отформатировать JSON',
  formatBlocked: 'Исправьте синтаксическую ошибку, чтобы отформатировать',
  followSelectionOn: 'Следование включено: JSON прокручивается к выделенному слою или фигуре',
  followSelectionOff: 'Прокручивать JSON к выделенному слою или фигуре',
  find: 'Найти',
  notApplied: 'Не применено',
  notAppliedHint: 'Правки не попадут в анимацию, пока вы их не примените',
  lines: (n: number) => pluralRu(n, 'строка', 'строки', 'строк'),
  errorAt: (line: number, col: number) => `Строка ${line}:${col}`,
  errorJump: 'Перейти к ошибке',

  /* Banner */
  changedOutside: 'Анимация изменилась вне редактора JSON.',
  changedOutsideHint:
    'Обновите, чтобы увидеть текущую анимацию, или сохраните свои правки и примените их поверх.',
  reload: 'Обновить',
  keepEditing: 'Оставить мои правки',

  /* Large documents */
  largeTitle: 'Это большая анимация',
  largeDescription: (size: string) =>
    `Её JSON занимает ${size}. Показ в виде текста может занять несколько секунд.`,
  largeOpen: 'Показать JSON',

  /* Breadcrumb and cursor */
  root: 'Документ',
  pathLabel: 'Путь JSON под курсором',
  position: (line: number, col: number) => `Стр ${line}, стлб ${col}`,
  copyPath: 'Скопировать путь',
  selectNode: (name: string) => `Выделить «${name}»`,
  notFound: 'Не найдено в изменённом JSON',
  unfold: 'Развернуть',

  /* History and results */
  historyApply: 'Правка JSON',
  appliedWithRepairs: (n: number) =>
    `Применено, ${pluralRu(n, 'автоматическое исправление', 'автоматических исправления', 'автоматических исправлений')}`,
  repairs: {
    fr: 'Некорректная частота кадров заменена на 30 к/с',
    ip: 'Отсутствующая точка входа установлена в 0',
    op: 'Некорректная точка выхода исправлена',
    w: 'Некорректная ширина заменена на 512',
    h: 'Некорректная высота заменена на 512',
    layers: 'Создан отсутствующий список слоёв',
  },

  /* Errors */
  jsonErrors: {
    empty: () => 'Документ пуст',
    'unexpected-end': () => 'JSON обрывается — не закрыта скобка или кавычка',
    'unexpected-token': (found: string) => `Неожиданный символ «${found}»`,
    'expected-property': () => 'Ожидалось имя свойства в двойных кавычках',
    'trailing-comma': () => 'Уберите запятую перед закрывающей скобкой',
    'expected-colon': () => 'Ожидалось «:» после имени свойства',
    'expected-comma-object': () => 'Ожидалось «,» или «}» после значения',
    'expected-comma-array': () => 'Ожидалось «,» или «]» после значения',
    'unterminated-string': () => 'Строка не закрыта — не хватает кавычки',
    'bad-escape': (found: string) => `Недопустимая escape-последовательность «${found}»`,
    'control-character': () =>
      'Табуляцию и другие управляющие символы в строках нужно экранировать',
    'bad-number': (found: string) => `Некорректное число «${found}»`,
    'bad-literal': (found: string) =>
      `Неизвестное значение «${found}» — используйте true, false или null`,
    'trailing-content': () => 'Лишний текст после конца JSON',
    comment: () => 'Комментарии в JSON не допускаются',
  },
  shapeErrors: {
    'not-object': 'Анимация Lottie должна быть объектом JSON',
    'no-layers': 'Это не анимация Lottie: нет списка «layers»',
    'no-dimensions': 'Это не анимация Lottie: нет ни «w», ни «h», ни «fr», ни «op»',
    'layer-not-object': 'Каждый слой должен быть объектом',
    'layer-type': 'Тип слоя «ty» должен быть числом',
    'layer-transform': 'У слоя нет трансформации «ks»',
    'assets-not-array': '«assets» должен быть списком',
    'asset-not-object': 'Каждый ресурс должен быть объектом',
    'asset-id': 'У каждого ресурса должен быть «id»',
    'precomp-layers': '«layers» прекомпозиции должен быть списком',
    'fonts-list': '«fonts.list» должен быть списком',
    'markers-not-array': '«markers» должен быть списком',
  },

  /* Search panel */
  search: {
    find: 'Найти',
    replace: 'Заменить',
    matchCase: 'С учётом регистра',
    regexp: 'Регулярное выражение',
    wholeWord: 'Слово целиком',
    previous: 'Предыдущее совпадение',
    next: 'Следующее совпадение',
    replaceOne: 'Заменить',
    replaceAll: 'Заменить все',
    toggleReplace: 'Показать замену',
    close: 'Закрыть',
    noResults: 'Нет совпадений',
    invalid: 'Некорректное выражение',
    count: (index: number, total: number) => `${index} из ${total}`,
    matches: (n: number) => pluralRu(n, 'совпадение', 'совпадения', 'совпадений'),
    manyMatches: (n: number) => `${n}+ совпадений`,
  },

  /* Commands */
  commands: {
    apply: 'Применить правки JSON',
    format: 'Отформатировать JSON',
    revert: 'Сбросить правки JSON',
    followSelection: 'Следовать за выделением в JSON',
    revealInCode: 'Показать в JSON',
    find: 'Найти в JSON',
  },

  phrases: {
    'Go to line': 'Перейти к строке',
    go: 'перейти',
    'Folded lines': 'Свёрнутые строки',
    'Unfolded lines': 'Развёрнутые строки',
    'Fold line': 'Свернуть строку',
    'Unfold line': 'Развернуть строку',
    'folded code': 'свёрнутый код',
    unfold: 'развернуть',
    to: 'до',
    Diagnostics: 'Диагностика',
    'No diagnostics': 'Нет замечаний',
    'Control character': 'Управляющий символ',
    'Selection deleted': 'Выделение удалено',
    'current match': 'текущее совпадение',
    'on line': 'в строке',
    'replaced $ matches': 'заменено совпадений: $',
    'replaced match on line $': 'заменено совпадение в строке $',
  },
}

export default code
