import type en from '../en/viewport'
import type { MovedKind } from '../en/viewport'
import { pluralRu } from '../../plural'

const viewport: typeof en = {
  canvasLabel: 'Холст анимации',
  cursor: (x: number, y: number) => `x ${x} · y ${y}`,
  loading: 'Загрузка предпросмотра…',
  unknownError: 'Неизвестная ошибка',

  zoom: 'Масштаб',
  zoomIn: 'Увеличить',
  zoomOut: 'Уменьшить',
  zoomFit: 'Вписать в окно',
  zoom100: 'Масштаб 100%',
  zoomSelection: 'Масштаб по выделению',

  background: 'Фон холста',
  backgrounds: {
    checker: 'Шахматка',
    dark: 'Тёмный',
    light: 'Светлый',
    custom: 'Свой',
  },
  backgroundCommands: {
    checker: 'Шахматный фон',
    dark: 'Тёмный фон',
    light: 'Светлый фон',
    custom: 'Свой цвет фона',
  },
  backgroundCycle: 'Следующий фон холста',

  renderer: 'Рендерер',
  rendererTooltip: (name: string) => `Рендерер: ${name}`,
  renderers: {
    svg: 'SVG',
    canvas: 'Canvas',
  },
  rendererHints: {
    svg: 'Точно, слои выбираются кликом',
    canvas: 'Быстрее, без выбора на холсте',
  },
  canvasNoSelection: 'Выбирать слои на холсте можно только с SVG-рендерером',

  bounds: 'Рамка анимации',
  showBounds: 'Показывать рамку анимации',
  compare: 'Сравнить с оригиналом',
  original: 'Оригинал',
  edited: 'С изменениями',
  noChanges: 'Без изменений',

  previewFailed: 'Ошибка предпросмотра',
  errorInvalidData: 'lottie-web не смог отрисовать файл',
  showIssues: 'Показать проблемы',
  tryAgain: 'Повторить',
  dismiss: 'Скрыть',

  expressionsOff: 'Выражения выключены',
  expressionsOn: 'Выражения включены',
  expressionsTitle: 'В файле есть выражения',
  expressionsBody:
    'Выражения выполняют JavaScript из файла. Включайте их только для файлов, которым доверяете.',
  expressionsEnable: 'Выполнять выражения',

  // Десятичный разделитель — запятая, поэтому координаты разделяются «; » (290,5; 404).
  dragPosition: (x: string, y: string) => `Положение ${x}; ${y}`,
  dragOffset: (dx: string, dy: string) => `Δ ${dx}; ${dy}`,
  readoutSize: (w: string, h: string) => `${w} × ${h}`,
  readoutScale: (x: string, y: string | null) => (y === null ? `${x}%` : `${x}% × ${y}%`),
  readoutAngle: (degrees: string) => `${degrees}°`,

  historyMove: (n: number, kind: MovedKind) => {
    if (n === 1) return kind === 'group' ? 'Перемещение группы' : 'Перемещение слоя'
    // «Перемещение 2 слоёв», «Перемещение 21 слоя»: genitive after the noun.
    if (kind === 'layer') return `Перемещение ${pluralRu(n, 'слоя', 'слоёв', 'слоёв')}`
    if (kind === 'group') return `Перемещение ${pluralRu(n, 'группы', 'групп', 'групп')}`
    return `Перемещение ${pluralRu(n, 'элемента', 'элементов', 'элементов')}`
  },
  historyResize: (n: number, kind: MovedKind) => {
    if (n === 1) return kind === 'group' ? 'Изменение размера группы' : 'Изменение размера слоя'
    if (kind === 'layer') return `Изменение размера ${pluralRu(n, 'слоя', 'слоёв', 'слоёв')}`
    if (kind === 'group') return `Изменение размера ${pluralRu(n, 'группы', 'групп', 'групп')}`
    return `Изменение размера ${pluralRu(n, 'элемента', 'элементов', 'элементов')}`
  },
  historyRotate: (n: number, kind: MovedKind) => {
    if (n === 1) return kind === 'group' ? 'Поворот группы' : 'Поворот слоя'
    if (kind === 'layer') return `Поворот ${pluralRu(n, 'слоя', 'слоёв', 'слоёв')}`
    if (kind === 'group') return `Поворот ${pluralRu(n, 'группы', 'групп', 'групп')}`
    return `Поворот ${pluralRu(n, 'элемента', 'элементов', 'элементов')}`
  },
  historyDuplicate: (n: number, kind: MovedKind) => {
    if (n === 1) return kind === 'group' ? 'Дублирование группы' : 'Дублирование слоя'
    if (kind === 'layer') return `Дублирование ${pluralRu(n, 'слоя', 'слоёв', 'слоёв')}`
    if (kind === 'group') return `Дублирование ${pluralRu(n, 'группы', 'групп', 'групп')}`
    return `Дублирование ${pluralRu(n, 'элемента', 'элементов', 'элементов')}`
  },
}

export default viewport
