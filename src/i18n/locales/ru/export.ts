import type en from '../en/export'
import { pluralRu } from '../../plural'

/** Only the word of a plural (1 раз, 2 раза, 5 раз → раз / раза / раз), for units after a field. */
const pluralWord = (n: number, one: string, few: string, many: string) =>
  pluralRu(n, one, few, many).replace(/^\S+\s/, '')

const exportNs: typeof en = {
  title: 'Экспорт',

  groups: {
    animation: 'Файлы анимации',
    video: 'Видео и GIF',
    images: 'Изображения',
    developers: 'Разработчикам',
  },

  formats: {
    json: { name: 'Lottie JSON', hint: 'Для веба и приложений' },
    dotlottie: { name: 'dotLottie', hint: 'Сжатый, всё внутри' },
    tgs: { name: 'Стикер Telegram', hint: 'Анимированный стикер .tgs' },
    gif: { name: 'GIF', hint: 'Работает везде, 256 цветов' },
    mp4: { name: 'Видео (MP4)', hint: 'H.264 для соцсетей' },
    webm: { name: 'Видео (WebM)', hint: 'VP9 с прозрачностью' },
    png: { name: 'Секвенция PNG', hint: 'Все кадры в ZIP-архиве' },
    framePng: { name: 'Кадр (PNG)', hint: 'Один кадр как изображение' },
    frameSvg: { name: 'Кадр (SVG)', hint: 'Один кадр в векторе' },
    embed: { name: 'Код для встраивания', hint: 'Фрагменты для сайтов' },
  },
  notAvailable: 'Недоступно в этом браузере',
  previewLabel: 'Превью экспортируемого файла',

  /* ------------------------------ Footer ------------------------------ */
  fileName: 'Имя файла',
  export: 'Экспортировать',
  copy: 'Копировать',
  copied: 'Скопировано',
  copyCode: 'Копировать код',
  download: (name: string) => `Скачать ${name}`,
  cancel: 'Отмена',
  exporting: 'Экспорт…',
  preparing: 'Подготовка…',
  finishing: 'Завершение…',
  rendering: (done: number, total: number) =>
    `Рендеринг: ${done} из ${pluralRu(total, 'кадра', 'кадров', 'кадров')}`,
  secondsLeft: (s: number) => (s <= 1 ? 'осталось около секунды' : `осталось ${s} с`),
  cancelHint: 'Остановить экспорт',

  summary: {
    frames: (from: number, to: number) => (from === to ? `Кадр ${from}` : `Кадры ${from}–${to}`),
    seconds: (s: string) => `${s} с`,
    repeated: (times: number, s: string) => `${times} × ${s} с`,
    countAt: (n: number, fps: string) => `${pluralRu(n, 'кадр', 'кадра', 'кадров')}, ${fps} к/с`,
    size: (w: number, h: number) => `${w} × ${h}`,
    estimate: (size: string) => `≈ ${size}`,
    gzip: (size: string) => `${size} в gzip`,
    files: (n: number) => pluralRu(n, 'файл', 'файла', 'файлов'),
    of: (size: string, limit: string) => `${size} из ${limit}`,
    measuring: 'Оценка размера…',
  },

  /* ------------------------------ Options ----------------------------- */
  fields: {
    size: 'Размер',
    frameRate: 'Частота кадров',
    range: 'Диапазон',
    background: 'Фон',
    matte: 'Кайма',
    threshold: 'Порог',
    colors: 'Цвета',
    dithering: 'Дизеринг',
    palette: 'Палитра',
    loop: 'Повтор',
    quality: 'Качество',
    repeat: 'Проиграть',
    codec: 'Кодек',
    frame: 'Кадр',
    renderer: 'Рендерер',
    formatting: 'Форматирование',
    precision: 'Точность',
    names: 'Имена',
    images: 'Изображения',
    version: 'Версия',
    contents: 'Содержимое',
    autoplay: 'Автозапуск',
    speed: 'Скорость',
    direction: 'Направление',
    code: 'Код',
    player: 'Плеер',
    json: 'JSON',
    gzip: 'В gzip',
    widthShort: 'Ш',
    heightShort: 'В',
  },

  sizes: {
    '0.5x': '0,5×',
    '1x': '1×',
    '2x': '2×',
    '3x': '3×',
    '4x': '4×',
    '720p': '720p',
    '1080p': '1080p',
    '4k': '4K',
    custom: 'Свой',
  },
  keepAspect: 'Сохранять пропорции',
  evenSize: 'Округлено до чётных чисел — этого требуют видеокодеки.',
  sizeLimited:
    'Уменьшено до максимального размера, который браузеры могут отрисовать (8192 px, 16,7 Мп).',
  letterbox: 'Пропорции отличаются от анимации: она будет по центру, по краям — фон.',

  fpsSource: 'исходная',
  fps: (fps: string) => `${fps} к/с`,
  gifFpsCap: 'GIF воспроизводится не быстрее 50 кадров в секунду.',

  rangeAll: 'Вся анимация',
  rangeWorkArea: 'Рабочая область',
  rangeNoWorkArea: 'Сначала задайте рабочую область на таймлайне (B и N).',

  bgColor: 'Цвет',
  bgTransparent: 'Прозрачный',
  matteHint: 'Полупрозрачные края смешиваются с этим цветом.',
  thresholdHint: 'Пиксели прозрачнее этого значения станут полностью прозрачными.',

  paletteShared: 'Общая',
  palettePerFrame: 'Для каждого кадра',
  paletteHint:
    'Общая: одна палитра, файл меньше, без мерцания. Для каждого кадра: точнее цвета, если изображение сильно меняется.',
  ditherHint: 'Плавнее градиенты, но файл больше.',
  loopForever: 'Всегда',
  loopOnce: 'Один раз',
  loopCustom: 'Другое',
  times: (n: number) => pluralWord(n, 'раз', 'раза', 'раз'),

  quality: { low: 'Низкое', medium: 'Среднее', high: 'Высокое' },
  playerLoop: 'Начинать заново в конце',
  playerAutoplay: 'Запускать сразу после загрузки',
  repeatHint:
    'Проигрывает анимацию несколько раз подряд — для площадок с минимальной длиной видео.',

  renderers: {
    auto: (name: string) => `Как на холсте (${name})`,
    svg: 'SVG',
    canvas: 'Canvas',
  },
  rendererHint:
    'SVG совпадает с превью редактора. Canvas быстрее, но не поддерживает некоторые эффекты.',
  svgFontsNote:
    'С рендерером SVG текст с веб-шрифтами может отрисоваться запасным шрифтом. Для точных шрифтов выберите Canvas.',

  /* ------------------------------- Notes ------------------------------ */
  gifTransparencyNote:
    'В GIF пиксель либо прозрачный, либо нет, поэтому мягкие края выглядят рваными. WebM сохраняет плавную прозрачность.',
  mp4NoAlpha: 'В MP4 нет прозрачности. Для прозрачного видео выберите WebM.',
  webmAlphaNote:
    'Прозрачный WebM воспроизводится в Chrome, Edge и Firefox. Safari показывает чёрный фон.',
  codecFallback: (name: string) =>
    `H.264 недоступен в этом браузере, поэтому видео будет в ${name}.`,
  checkingEncoder: 'Проверка видеокодера…',
  unsupported: {
    title: (container: string) => `Этот браузер не умеет кодировать видео ${container}`,
    noWebCodecs:
      'Экспорт видео использует WebCodecs — они есть в Chrome, Edge, Safari 16.4+ и Firefox 130+.',
    noCodec: (size: string) =>
      `Здесь нет кодера для размера ${size}. Попробуйте меньший размер или другую частоту кадров.`,
    error: 'Не удалось проверить видеокодер. Перезагрузите страницу и попробуйте снова.',
  },
  missingImagesNote: (n: number) =>
    n === 1
      ? 'Одно изображение не входит в файл и будет пустым. Встройте его на панели «Ресурсы».'
      : `${pluralRu(n, 'изображение не входит', 'изображения не входят', 'изображений не входят')} в файл и будут пустыми. Встройте их на панели «Ресурсы».`,
  expressionsNote:
    'Выражения в превью выключены, поэтому не будут отрисованы. Включите их в настройках холста.',

  /* ---------------------------- Lottie JSON --------------------------- */
  json: {
    minified: 'Сжатый',
    pretty: 'Читаемый',
    keepDecimals: 'Все знаки',
    decimals: (n: number) => pluralRu(n, 'знак', 'знака', 'знаков'),
    precisionHint: 'Округляет координаты и время. Цвета и кривые интерполяции сохраняют 3 знака.',
    stripNames: 'Удалить имена слоёв',
    stripNamesWarning:
      'Перестанут работать выражения и доступ к свойствам по пути (dynamic properties в lottie-ios и lottie-android).',
    imagesEmbedded: 'Встроены',
    imagesFiles: 'Отдельные файлы',
    imagesFilesHint: 'Экспортирует ZIP-архив с JSON и папкой изображений.',
    savings: (pct: string) => `на ${pct} меньше`,
    larger: (pct: string) => `на ${pct} больше`,
  },

  /* ----------------------------- dotLottie ---------------------------- */
  dotlottie: {
    auto: (v: number) => `Автоматически · v${v}`,
    v1: 'dotLottie 1',
    v1Hint: 'максимальная совместимость',
    v2: 'dotLottie 2',
    v2Hint: 'темы и конечные автоматы',
    v2Required: 'Темам и конечным автоматам этого файла нужен dotLottie 2.',
    imagesAsFiles: 'Хранить изображения файлами',
    includePackage: 'Сохранить остальное содержимое файла',
    packageAnimations: (n: number) => `ещё ${pluralRu(n, 'анимация', 'анимации', 'анимаций')}`,
    packageThemes: (n: number) => pluralRu(n, 'тема', 'темы', 'тем'),
    packageStateMachines: (n: number) =>
      pluralRu(n, 'конечный автомат', 'конечных автомата', 'конечных автоматов'),
    normal: 'Вперёд',
    bounce: 'Туда-обратно',
    playerHint:
      'Записывается в манифест; плееры, которые его читают (lottie-ios, плееры dotLottie), стартуют так.',
    playerV2Hint: 'В dotLottie 2 нет настроек плеера: задайте повтор и автозапуск в коде.',
  },

  /* ------------------------------ Telegram ---------------------------- */
  tgs: {
    requirements: 'Требования Telegram',
    ready: 'Готово для Telegram',
    issues: (n: number) =>
      n === 1
        ? 'Telegram может не принять этот стикер: 1 проблема.'
        : `Telegram может не принять этот стикер: ${pluralRu(n, 'проблема', 'проблемы', 'проблем')}.`,
    fixes: 'Исправить при экспорте',
    fixesHint: 'Исправления меняют только экспортируемый файл, документ остаётся прежним.',
    fitSize: 'Вписать в 512 × 512',
    fixFps: 'Перевести в 60 к/с',
    longer: 'Если дольше 3 с',
    keep: 'Оставить',
    trim: 'Обрезать до 3 с',
    speedUp: 'Ускорить до 3 с',
    checks: {
      size: 'Холст 512 × 512',
      fps: '60 кадров в секунду',
      duration: 'Не дольше 3 секунд',
      fileSize: 'Не больше 64 КБ в сжатом виде',
      expressions: 'Выражения',
      masks: 'Маски',
      effects: 'Эффекты слоёв',
      images: 'Изображения',
      solids: 'Слои-заливки',
      texts: 'Текстовые слои',
      threeD: '3D-слои',
      mergePaths: 'Слияние контуров',
      stars: 'Звёзды и многоугольники',
      gradientStrokes: 'Градиентные обводки',
      repeaters: 'Повторители',
      timeStretch: 'Растяжение времени',
      timeRemap: 'Переназначение времени',
      autoOrient: 'Автоориентация',
    },
    unsupportedFeatures: 'Неподдерживаемые возможности',
    noFeatures: 'Не используются',
    usedIn: (names: string) => `Используется: ${names}`,
    count: (n: number) => `${n}`,
    sizeValue: (w: number, h: number) => `${w} × ${h}`,
    fpsValue: (fps: string) => `${fps} к/с`,
    durationValue: (s: string) => `${s} с`,
  },

  /* ------------------------------- Frames ----------------------------- */
  frame: {
    playhead: 'Взять кадр под указателем воспроизведения',
    of: (last: number) => `из ${last}`,
    svgSizeHint: 'Задаёт ширину и высоту SVG. Изображение остаётся векторным.',
    svgFontsNote:
      'Текст использует веб-шрифты, которых нет внутри SVG: другие программы покажут его запасным шрифтом.',
  },

  /* ------------------------- Still frame (Lottie) ---------------------- */
  still: {
    content: 'Содержимое',
    animation: 'Анимация',
    frame: 'Один кадр',
    note: 'В файле будет только этот кадр, без анимации: все значения зафиксированы, невидимое содержимое убрано.',
    expressions: (n: number) => `Не вошли выражения (${n}): кадр показывает значения по ключам.`,
    autoOrient: (n: number) =>
      `${pluralRu(n, 'наклонённый 3D-слой теряет', 'наклонённых 3D-слоя теряют', 'наклонённых 3D-слоёв теряют')} автоориентацию.`,
  },

  /* ---------------------------- PNG sequence -------------------------- */
  sequenceFiles: (first: string, last: string) => `${first} … ${last}`,

  /* ----------------------------- Embed code --------------------------- */
  embed: {
    html: 'HTML',
    wc: 'Веб-компонент',
    react: 'React',
    htmlHint: 'lottie-web с jsDelivr, без сборки.',
    wcHint: 'Веб-компонент dotLottie воспроизводит файл .lottie.',
    reactHint: 'Компонент lottie-react; JSON собирается вместе с приложением.',
    inline: 'Вставить JSON в код',
    inlineHint: 'Отдельный файл размещать не нужно.',
    inlineWarning: (size: string) =>
      `Добавит ${size} к странице, и браузер не сможет кешировать анимацию отдельно.`,
    hostHint: (name: string) => `Разместите ${name} рядом со страницей (кнопка «Скачать» ниже).`,
    importHint: (name: string) => `Положите ${name} рядом с компонентом (кнопка «Скачать» ниже).`,
    jsonPlaceholder: (size: string) => `JSON анимации, ${size}`,
    inlineSummary: 'JSON в коде',
  },

  /* ---------------------------- Results ------------------------------- */
  done: (name: string, size: string) => `Экспортирован ${name} · ${size}`,
  downloadAgain: 'Скачать снова',
  warnings: {
    missingImages: (n: number) =>
      n === 1
        ? 'Одно отсутствующее изображение осталось пустым.'
        : `${pluralRu(n, 'отсутствующее изображение осталось', 'отсутствующих изображения остались', 'отсутствующих изображений остались')} пустыми.`,
    unreachableImages: (n: number) =>
      n === 1
        ? 'Одно связанное изображение не удалось скачать, оно осталось пустым.'
        : `${pluralRu(n, 'связанное изображение', 'связанных изображения', 'связанных изображений')} не удалось скачать, они остались пустыми.`,
    renderErrors: (n: number) =>
      n === 1
        ? 'В одном кадре были ошибки отрисовки.'
        : `В ${pluralRu(n, 'кадре', 'кадрах', 'кадрах')} были ошибки отрисовки.`,
  },
  errors: {
    failed: 'Не удалось экспортировать',
    videoUnsupported:
      'Этот браузер не умеет кодировать такое видео. Попробуйте WebM, другой размер или Chrome.',
    clipboardImage: 'Этот браузер не умеет копировать изображения. Воспользуйтесь экспортом.',
    clipboard: 'Не удалось скопировать в буфер обмена',
    v2Required: 'Темам и конечным автоматам нужен dotLottie 2.',
    memory: 'Не хватает памяти. Уменьшите размер или диапазон.',
    tainted:
      'Браузер запретил читать отрисованные кадры. Встройте связанные изображения и попробуйте снова.',
    build: (detail: string) => `lottie-web не смог собрать анимацию: ${detail}`,
  },

  /* ----------------------------- Commands ----------------------------- */
  commands: {
    export: 'Экспорт…',
    exportGif: 'Экспортировать в GIF…',
    exportMp4: 'Экспортировать в видео MP4…',
    exportWebm: 'Экспортировать в видео WebM…',
    exportJson: 'Экспортировать в Lottie JSON…',
    exportDotLottie: 'Экспортировать в dotLottie…',
    exportTgs: 'Экспортировать как стикер Telegram…',
    exportPngSequence: 'Экспортировать секвенцию PNG…',
    exportEmbed: 'Получить код для встраивания…',
    copyFramePng: 'Копировать кадр как PNG',
    copyFrameSvg: 'Копировать кадр как SVG',
    saveFramePng: 'Сохранить кадр как PNG',
    copyJson: 'Копировать Lottie JSON',
    exportFrameLottie: 'Экспорт кадра как Lottie…',
  },
}

export default exportNs
