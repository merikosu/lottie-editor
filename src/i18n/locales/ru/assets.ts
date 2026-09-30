import type en from '../en/assets'
import { pluralRu } from '../../plural'

const assets: typeof en = {
  filter: 'Фильтр ресурсов',
  add: 'Добавить ресурс',
  addImageHint: 'Добавить изображение…',
  addFontHint: 'Добавить шрифт…',
  more: 'Другие действия',
  rowActions: 'Действия',

  sections: {
    images: 'Изображения',
    compositions: 'Прекомпозиции',
    fonts: 'Шрифты',
  },
  empty: {
    images: 'Изображений пока нет.',
    imagesAction: 'Добавить…',
    compositions: 'Прекомпозиций нет.',
    fonts: 'Шрифтов нет.',
    fontsAction: 'Добавить…',
    filtered: 'Ничего не найдено.',
  },

  status: {
    linked: 'По ссылке',
    missing: 'Отсутствует',
  },
  statusHint: {
    linked: 'Загружается из интернета при воспроизведении',
    missing:
      'Файла нет внутри анимации, поэтому плееры ничего не покажут. Встройте его, чтобы это исправить.',
  },

  usage: (n: number) => `×${n}`,
  usedBy: (n: number) =>
    n === 0
      ? 'Не используется ни одним слоем — можно удалить'
      : `Используется в ${pluralRu(n, 'слое', 'слоях', 'слоях')}`,
  unreachable: 'Используется только в неиспользуемых прекомпозициях — можно удалить',
  layerCount: (n: number) => pluralRu(n, 'слой', 'слоя', 'слоёв'),
  textLayerCount: (n: number) => pluralRu(n, 'текстовый слой', 'текстовых слоя', 'текстовых слоёв'),
  sizeUnknown: 'Размер неизвестен',

  actions: {
    replace: 'Заменить…',
    locate: 'Указать файл…',
    embed: 'Встроить изображение',
    download: 'Скачать',
    rename: 'Переименовать',
    renameId: 'Изменить ID',
    copyId: 'Скопировать ID',
    copyName: 'Скопировать имя',
    selectLayers: (n: number) =>
      n === 1 ? 'Выделить слой' : `Выделить ${pluralRu(n, 'слой', 'слоя', 'слоёв')}`,
    showInJson: 'Показать в JSON',
    delete: 'Удалить',
    edit: 'Изменить…',
    addImage: 'Изображение…',
    addFont: 'Шрифт…',
    removeUnused: 'Удалить неиспользуемые ресурсы',
    embedMissing: 'Встроить отсутствующие изображения…',
  },
  dropToReplace: 'Отпустите для замены',
  preview: (w: number, h: number) => `${w} × ${h} px`,

  idEmpty: 'ID не может быть пустым',
  idTaken: 'Этот ID уже занят другим ресурсом',

  errors: {
    read: (name: string) => `Не удалось прочитать «${name}» как изображение`,
    readHint: 'Используйте файл PNG, JPEG, WebP, GIF или SVG.',
    download: 'Не удалось сохранить изображение',
    fetch: (name: string) => `Не удалось загрузить «${name}»`,
    fetchHint: 'Сервер этого не разрешает. Сохраните файл сами и выберите «Указать файл…».',
  },
  unmatched: (n: number) =>
    `${pluralRu(n, 'файл не подошёл', 'файла не подошли', 'файлов не подошли')} ни к одному отсутствующему изображению`,
  unmatchedHint: 'Отсутствующие изображения сопоставляются по имени файла.',
  noMatches: 'Ни один файл не подходит к отсутствующим изображениям',

  replaceDialog: {
    title: 'Замена изображения',
    description: (id: string) =>
      `Пропорции нового изображения отличаются от «${id}». Как его вписать?`,
    current: 'Сейчас',
    next: 'Новое',
    fit: 'Вписать в текущий размер',
    fitHint: 'Ничего не обрезается',
    fill: 'Обрезать по текущему размеру',
    fillHint: 'Края обрезаются, чтобы заполнить его',
    natural: 'Исходный размер изображения',
    naturalHint: 'Может стать больше или меньше',
    confirm: 'Заменить',
  },

  font: {
    family: 'Семейство',
    style: 'Начертание',
    name: 'Имя',
    nameHint: 'Текстовые слои ссылаются на шрифт по этому имени',
    source: 'Источник',
    familyRequired: 'Укажите семейство шрифта',
    available: 'Установлен на этом устройстве',
    unavailable: 'Не установлен на этом устройстве — в предпросмотре используется замена',
    origins: {
      local: 'Локальный',
      css: 'Веб-шрифт',
      script: 'Веб-шрифт (JS)',
      file: 'Файл шрифта',
    },
    addTitle: 'Новый шрифт',
    editTitle: 'Шрифт',
    add: 'Добавить',
    save: 'Сохранить',
    undefinedFonts: (names: string) => `В тексте есть шрифты не из списка: ${names}`,
  },

  history: {
    replaceImage: 'Замена изображения',
    addImage: 'Добавление изображения',
    addImages: (n: number) =>
      `Добавление: ${pluralRu(n, 'изображение', 'изображения', 'изображений')}`,
    embedImages: (n: number) =>
      `Встраивание: ${pluralRu(n, 'изображение', 'изображения', 'изображений')}`,
    renameAsset: 'Изменение ID ресурса',
    renameImage: 'Переименование изображения',
    renameComposition: 'Переименование прекомпозиции',
    deleteAsset: 'Удаление ресурса',
    removeUnused: 'Удаление неиспользуемых ресурсов',
    addFont: 'Добавление шрифта',
    editFont: 'Изменение шрифта',
    removeFont: 'Удаление шрифта',
  },

  commands: {
    replaceImage: 'Заменить изображение…',
    removeUnused: 'Удалить неиспользуемые ресурсы',
    embedMissing: 'Встроить отсутствующие изображения…',
    show: 'Показать ресурсы',
  },
}

export default assets
