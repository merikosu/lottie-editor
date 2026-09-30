import {
  ArrowLeftRight,
  CirclePause,
  Crop,
  FastForward,
  Gauge,
  Repeat2,
  Scaling,
  Scissors,
  Snail,
} from 'lucide-react'
import { registerDialog } from '@/commands/dialogs'
import { registerCommands, type Command } from '@/commands/registry'
import { getDoc } from '@/store/document'
import { openDialog } from '@/store/ui'
import {
  bakePingPong,
  fitToContent,
  multiplySpeed,
  reverse,
  trimRange,
  trimToWorkArea,
} from './actions'
import { PauseDialog } from './dialogs/PauseDialog'
import { ResizeDialog } from './dialogs/ResizeDialog'
import { TimingDialog } from './dialogs/TimingDialog'
import { trackSpeedLedger, trackTimeEdits, useDocopsState } from './store'

const hasDoc = () => getDoc() !== null

/**
 * Registers this feature's commands and dialogs. Called once by the app on startup;
 * returns a cleanup function.
 */
export function register(): () => void {
  const commands: Command[] = [
    {
      id: 'anim.timing',
      title: (t) => t.docops.commands.timing,
      category: 'animation',
      icon: Gauge,
      keywords: [
        'fps',
        'frame rate',
        'speed',
        'duration',
        'retime',
        'скорость',
        'частота кадров',
        'длительность',
      ],
      enabled: hasDoc,
      run: () => openDialog('timing'),
    },
    {
      id: 'anim.resize',
      title: (t) => t.docops.commands.resize,
      category: 'animation',
      icon: Scaling,
      keywords: [
        'size',
        'dimensions',
        'width',
        'height',
        'artboard',
        'scale',
        'размер',
        'ширина',
        'высота',
        'масштаб',
      ],
      enabled: hasDoc,
      run: () => openDialog('resize'),
    },
    {
      id: 'anim.trim',
      title: (t) => t.docops.commands.trim,
      category: 'animation',
      icon: Scissors,
      // After Effects: Trim Comp to Work Area.
      shortcut: 'mod+shift+x',
      keywords: ['cut', 'in point', 'out point', 'обрезать', 'рабочая область'],
      enabled: () => trimRange() !== null,
      run: () => void trimToWorkArea(),
    },
    {
      id: 'anim.fitToContent',
      title: (t) => t.docops.commands.fit,
      category: 'animation',
      icon: Crop,
      keywords: [
        'crop',
        'padding',
        'trim canvas',
        'bounds',
        'обрезать',
        'отступы',
        'кадрировать',
        'холст',
      ],
      enabled: () => hasDoc() && useDocopsState.getState().busy === null,
      run: fitToContent,
    },
    {
      id: 'anim.reverse',
      title: (t) => t.docops.commands.reverse,
      category: 'animation',
      icon: ArrowLeftRight,
      keywords: ['backwards', 'rewind', 'time reverse', 'обратно', 'назад', 'реверс'],
      enabled: hasDoc,
      run: () => void reverse(),
    },
    {
      id: 'anim.addPause',
      title: (t) => t.docops.commands.addPause,
      category: 'animation',
      icon: CirclePause,
      keywords: ['hold', 'delay', 'loop delay', 'freeze', 'пауза', 'задержка', 'стоп-кадр'],
      enabled: hasDoc,
      run: () => openDialog('addPause'),
    },
    {
      id: 'anim.pingPong',
      title: (t) => t.docops.commands.pingPong,
      category: 'animation',
      icon: Repeat2,
      keywords: ['bounce', 'yoyo', 'boomerang', 'loop', 'бумеранг', 'туда-обратно'],
      enabled: hasDoc,
      run: () => void bakePingPong(),
    },
    {
      id: 'anim.speedUp',
      title: (t) => t.docops.commands.speedUp,
      category: 'animation',
      icon: FastForward,
      keywords: ['faster', '2x', 'speed', 'быстрее', 'скорость'],
      enabled: hasDoc,
      run: () => void multiplySpeed(2),
    },
    {
      id: 'anim.slowDown',
      title: (t) => t.docops.commands.slowDown,
      category: 'animation',
      icon: Snail,
      keywords: ['slower', 'slow motion', '0.5x', 'speed', 'медленнее', 'скорость'],
      enabled: hasDoc,
      run: () => void multiplySpeed(0.5),
    },
  ]

  const disposers = [
    registerCommands(commands),
    registerDialog('timing', TimingDialog),
    registerDialog('resize', ResizeDialog),
    registerDialog('addPause', PauseDialog),
    trackSpeedLedger(),
    trackTimeEdits(),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
