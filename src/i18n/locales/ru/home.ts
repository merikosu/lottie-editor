import type en from '../en/home'

const home: typeof en = {
  tagline:
    'Редактирование, кастомизация и оптимизация Lottie-анимаций прямо в браузере. Файлы остаются на этом устройстве.',

  services: {
    edit: {
      description: 'Полный контроль: слои, ключевые кадры, интерполяция, тайминг и JSON.',
      action: 'Открыть файл…',
      drop: 'Отпустите, чтобы редактировать',
      dropHint: 'Откроется в редакторе',
    },
    customize: {
      description: 'Поставьте свой логотип, фирменные цвета и тексты в готовую анимацию.',
      action: 'Выбрать Lottie…',
      drop: 'Отпустите, чтобы кастомизировать',
      dropHint: 'Откроется в режиме кастомизации',
    },
    optimize: {
      // No-break space: the dash stays at the end of the line in Russian typesetting.
      description: 'Уменьшите файлы без видимых изменений\u00a0— с покадровой проверкой.',
      action: 'Оптимизировать файлы…',
      drop: 'Отпустите, чтобы оптимизировать',
      dropHint: 'Файлы добавятся в очередь оптимизации',
    },
  },

  replaces: (name) => `Заменит «${name}»`,
  newAnimation: 'Новая анимация',
  openUrl: 'Открыть по ссылке…',
  hint: 'Перетащите файлы на карточку или вставьте JSON либо ссылку',

  current: {
    label: 'Открытая анимация',
    continue: 'Продолжить редактирование',
    customize: 'Кастомизировать',
    optimize: 'Оптимизировать',
  },

  menu: {
    customize: 'Открыть в кастомизации',
    optimize: 'Оптимизировать',
  },
}

export default home
