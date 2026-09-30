/**
 * Commands of the colors feature. Menus and the command palette pick them up by id
 * (`anim.colors` is in the Animation menu).
 */
import {
  ClipboardCopy,
  Contrast,
  DropletOff,
  Palette,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react'
import { registerCommands, type Command } from '@/commands/registry'
import { getT } from '@/i18n'
import { groupColors, groupGradients, scanColors } from '@/lottie/colors'
import { getDoc } from '@/store/document'
import {
  copyWithFlash,
  documentUsages,
  focusAdjustSection,
  grayscaleUsages,
  hasModifiedUsages,
  invertUsages,
  resetUsages,
  showColorsPanel,
} from './actions'
import { formatPalette } from './palette-export'

const hasDoc = () => getDoc() !== null
const hasColors = () => documentUsages().length > 0

const COLOR_KEYWORDS = [
  'color',
  'colors',
  'recolor',
  'palette',
  'swatch',
  'theme',
  'replace color',
  'цвет',
  'цвета',
  'палитра',
  'перекрасить',
  'тема',
]

/**
 * Registers this feature's commands and dialogs. Called once by the app on startup;
 * returns a cleanup function.
 */
export function register(): () => void {
  const commands: Command[] = [
    {
      id: 'anim.colors',
      title: (t) => t.colors.commands.open,
      category: 'animation',
      icon: Palette,
      keywords: COLOR_KEYWORDS,
      enabled: hasDoc,
      run: showColorsPanel,
    },
    {
      id: 'colors.adjust',
      title: (t) => t.colors.commands.adjust,
      category: 'animation',
      icon: SlidersHorizontal,
      keywords: [
        'hue',
        'saturation',
        'lightness',
        'brightness',
        'оттенок',
        'насыщенность',
        'яркость',
        'коррекция',
        ...COLOR_KEYWORDS,
      ],
      enabled: hasColors,
      run: focusAdjustSection,
    },
    {
      id: 'colors.copyPalette',
      title: (t) => t.colors.commands.copyPalette,
      category: 'animation',
      icon: ClipboardCopy,
      keywords: ['hex', 'export palette', 'css', 'скопировать палитру', ...COLOR_KEYWORDS],
      enabled: hasColors,
      run: async () => {
        const doc = getDoc()
        if (!doc) return
        const scan = scanColors(doc)
        const groups = groupColors(scan.colors)
        await copyWithFlash(
          formatPalette(groups, groupGradients(scan.gradients), 'hex'),
          getT().colors.flash.copiedPalette(groups.length),
        )
      },
    },
    {
      id: 'colors.invert',
      title: (t) => t.colors.commands.invert,
      category: 'animation',
      icon: Contrast,
      keywords: ['invert', 'negative', 'инверсия', 'негатив', ...COLOR_KEYWORDS],
      enabled: hasColors,
      run: () => void invertUsages(documentUsages()),
    },
    {
      id: 'colors.grayscale',
      title: (t) => t.colors.commands.grayscale,
      category: 'animation',
      icon: DropletOff,
      keywords: [
        'grayscale',
        'greyscale',
        'desaturate',
        'black and white',
        'серый',
        'обесцветить',
        'чёрно-белый',
        ...COLOR_KEYWORDS,
      ],
      enabled: hasColors,
      run: () => void grayscaleUsages(documentUsages()),
    },
    {
      id: 'colors.resetAll',
      title: (t) => t.colors.commands.resetAll,
      category: 'animation',
      icon: RotateCcw,
      keywords: ['original colors', 'revert colors', 'исходные цвета', ...COLOR_KEYWORDS],
      enabled: () => hasModifiedUsages(documentUsages()),
      run: () => void resetUsages(documentUsages()),
    },
  ]
  return registerCommands(commands)
}
