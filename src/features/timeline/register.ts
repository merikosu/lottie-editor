/**
 * Registers the timeline's commands (keyframes, keyframe navigation, markers, layer timing,
 * timeline view) and the keyframe paste handler. Called once by the app on startup.
 */
import {
  AlignHorizontalDistributeCenter,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  BookmarkPlus,
  ChartSpline,
  Gauge,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  FlipHorizontal2,
  GanttChart,
  ListChevronsUpDown,
  Scissors,
  Trash2,
  UnfoldHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { registerPasteHandler, type PasteData } from '@/commands/paste'
import { registerCommands, type Command } from '@/commands/registry'
import type { Dict } from '@/i18n'
import { EASING_PRESETS } from '@/lottie/easing'
import { getMarkers } from '@/lottie/markers'
import { isKeyframeClipboard } from '@/lottie/timeline-ops'
import { getDoc, useDocument } from '@/store/document'
import {
  addMarkerAt,
  copySelectedKeys,
  cutSelectedKeys,
  deleteSelectedKeys,
  distributeSelected,
  easyEaseSelected,
  focusTimeline,
  goToKeyframe,
  goToMarker,
  hasDocument,
  hasSelectedKeys,
  hasSelectedLayers,
  isTimelineFocused,
  layerTimeToPlayhead,
  nudgeSelected,
  pasteKeys,
  revealAnimatedProperties,
  reverseSelected,
  selectAllKeysInScope,
  setSelectedEasing,
  showGraphMode,
  toggleGraph,
  toggleGraphFit,
  toggleGraphNormalize,
  toggleHoldSelected,
} from './actions'
import { hasKeyClipboard, useKeyClipboard } from './clipboard'
import { getTimelineRuntime } from './runtime'
import { setTimelinePrefs, useTimelinePrefs, useTimelineView } from './store'

const c = (d: Dict) => d.timeline.commands

const keyCount = () => useDocument.getState().selection.keyframes.length
const hasMarkers = () => {
  const doc = getDoc()
  return !!doc && getMarkers(doc).length > 0
}

/** ⌘V pastes keyframes only when they have a clear destination; otherwise layers paste. */
function canPasteKeys(): boolean {
  if (!hasDocument() || !hasKeyClipboard()) return false
  const sel = useDocument.getState().selection
  return sel.property !== null || sel.keyframes.length > 0
}

function onPaste(data: PasteData): boolean {
  if (!getDoc() || !isKeyframeClipboard(data.json)) return false
  // Keys copied in another tab become the in-memory clipboard too.
  useKeyClipboard.setState({ clip: data.json })
  pasteKeys(data.json)
  return true
}

export function register(): () => void {
  const commands: Command[] = [
    /* -------------------------------- Keyframes ------------------------------- */
    {
      id: 'keyframes.delete',
      title: (d) => c(d).deleteKeys,
      category: 'edit',
      icon: Trash2,
      shortcut: ['backspace', 'delete'],
      enabled: hasSelectedKeys,
      run: () => deleteSelectedKeys(),
    },
    {
      id: 'keyframes.copy',
      title: (d) => c(d).copyKeys,
      category: 'edit',
      icon: Copy,
      shortcut: 'mod+c',
      enabled: hasSelectedKeys,
      run: () => void copySelectedKeys(),
    },
    {
      id: 'keyframes.cut',
      title: (d) => c(d).cutKeys,
      category: 'edit',
      icon: Scissors,
      shortcut: 'mod+x',
      enabled: hasSelectedKeys,
      run: cutSelectedKeys,
    },
    {
      id: 'keyframes.paste',
      title: (d) => c(d).pasteKeys,
      category: 'edit',
      shortcut: 'mod+v',
      enabled: canPasteKeys,
      run: () => void pasteKeys(),
    },
    {
      id: 'keyframes.selectAll',
      title: (d) => c(d).selectAllKeys,
      category: 'edit',
      shortcut: 'mod+a',
      enabled: () => hasDocument() && (isTimelineFocused() || hasSelectedKeys()),
      run: selectAllKeysInScope,
    },
    {
      id: 'keyframes.easyEase',
      title: (d) => c(d).easyEase,
      category: 'edit',
      shortcut: 'f9',
      keywords: ['easing', 'interpolation', 'bezier', 'сглаживание'],
      enabled: hasSelectedKeys,
      run: () => easyEaseSelected('both'),
    },
    {
      id: 'keyframes.easeIn',
      title: (d) => c(d).easeIn,
      category: 'edit',
      shortcut: 'shift+f9',
      enabled: hasSelectedKeys,
      run: () => easyEaseSelected('in'),
    },
    {
      id: 'keyframes.easeOut',
      title: (d) => c(d).easeOut,
      category: 'edit',
      shortcut: 'mod+shift+f9',
      enabled: hasSelectedKeys,
      run: () => easyEaseSelected('out'),
    },
    {
      id: 'keyframes.toggleHold',
      title: (d) => c(d).toggleHold,
      category: 'edit',
      shortcut: 'mod+alt+h',
      keywords: ['step', 'stepped', 'hold'],
      enabled: hasSelectedKeys,
      run: toggleHoldSelected,
    },
    ...EASING_PRESETS.map<Command>((preset) => ({
      id: `keyframes.easing.${preset.id}`,
      title: (d) =>
        preset.id === 'linear'
          ? c(d).linear
          : ((d.timeline.easing as Record<string, string>)[preset.id] ?? preset.id),
      category: 'edit',
      hidden: preset.id !== 'linear',
      keywords: ['easing', 'interpolation'],
      enabled: hasSelectedKeys,
      run: () => setSelectedEasing(preset.curve),
    })),
    {
      id: 'keyframes.reverse',
      title: (d) => c(d).reverseKeys,
      category: 'edit',
      icon: FlipHorizontal2,
      keywords: ['time-reverse', 'mirror'],
      enabled: () => keyCount() >= 2,
      run: reverseSelected,
    },
    {
      id: 'keyframes.distribute',
      title: (d) => c(d).distributeKeys,
      category: 'edit',
      icon: AlignHorizontalDistributeCenter,
      keywords: ['space evenly', 'spacing'],
      enabled: () => keyCount() >= 3,
      run: distributeSelected,
    },
    {
      id: 'keyframes.nudgeLeft',
      title: (d) => c(d).nudgeLeft,
      category: 'edit',
      shortcut: 'alt+,',
      repeat: true,
      enabled: hasSelectedKeys,
      run: () => nudgeSelected(-1),
    },
    {
      id: 'keyframes.nudgeRight',
      title: (d) => c(d).nudgeRight,
      category: 'edit',
      shortcut: 'alt+.',
      repeat: true,
      enabled: hasSelectedKeys,
      run: () => nudgeSelected(1),
    },
    {
      id: 'keyframes.nudgeLeft10',
      title: (d) => c(d).nudgeLeft10,
      category: 'edit',
      shortcut: 'alt+shift+,',
      repeat: true,
      hidden: true,
      enabled: hasSelectedKeys,
      run: () => nudgeSelected(-10),
    },
    {
      id: 'keyframes.nudgeRight10',
      title: (d) => c(d).nudgeRight10,
      category: 'edit',
      shortcut: 'alt+shift+.',
      repeat: true,
      hidden: true,
      enabled: hasSelectedKeys,
      run: () => nudgeSelected(10),
    },

    /* -------------------------------- Playback -------------------------------- */
    {
      id: 'playback.prevKeyframe',
      title: (d) => c(d).prevKeyframe,
      category: 'playback',
      icon: ChevronsLeft,
      shortcut: 'j',
      repeat: true,
      enabled: hasDocument,
      run: () => goToKeyframe(-1),
    },
    {
      id: 'playback.nextKeyframe',
      title: (d) => c(d).nextKeyframe,
      category: 'playback',
      icon: ChevronsRight,
      shortcut: 'k',
      repeat: true,
      enabled: hasDocument,
      run: () => goToKeyframe(1),
    },
    {
      id: 'playback.prevMarker',
      title: (d) => c(d).prevMarker,
      category: 'playback',
      enabled: hasMarkers,
      run: () => goToMarker(-1),
    },
    {
      id: 'playback.nextMarker',
      title: (d) => c(d).nextMarker,
      category: 'playback',
      enabled: hasMarkers,
      run: () => goToMarker(1),
    },

    /* ---------------------------- Layers and markers --------------------------- */
    {
      id: 'layer.revealKeyframes',
      title: (d) => c(d).revealKeyframes,
      category: 'layer',
      icon: ListChevronsUpDown,
      shortcut: 'u',
      keywords: ['expand', 'properties', 'keyframes', 'развернуть'],
      enabled: hasDocument,
      run: revealAnimatedProperties,
    },
    {
      id: 'anim.addMarker',
      title: (d) => c(d).addMarker,
      category: 'animation',
      icon: BookmarkPlus,
      shortcut: 'm',
      keywords: ['segment', 'cue', 'маркер'],
      enabled: hasDocument,
      run: () => void addMarkerAt(),
    },
    {
      id: 'timeline.moveInPoint',
      title: (d) => c(d).moveInPoint,
      category: 'layer',
      icon: ArrowRightFromLine,
      shortcut: '[',
      enabled: hasSelectedLayers,
      run: () => layerTimeToPlayhead('moveIn'),
    },
    {
      id: 'timeline.moveOutPoint',
      title: (d) => c(d).moveOutPoint,
      category: 'layer',
      icon: ArrowLeftFromLine,
      shortcut: ']',
      enabled: hasSelectedLayers,
      run: () => layerTimeToPlayhead('moveOut'),
    },
    {
      id: 'timeline.trimInPoint',
      title: (d) => c(d).trimInPoint,
      category: 'layer',
      shortcut: 'alt+[',
      keywords: ['cut', 'trim', 'обрезать'],
      enabled: hasSelectedLayers,
      run: () => layerTimeToPlayhead('trimIn'),
    },
    {
      id: 'timeline.trimOutPoint',
      title: (d) => c(d).trimOutPoint,
      category: 'layer',
      shortcut: 'alt+]',
      keywords: ['cut', 'trim', 'обрезать'],
      enabled: hasSelectedLayers,
      run: () => layerTimeToPlayhead('trimOut'),
    },

    /* ---------------------------------- View ---------------------------------- */
    {
      id: 'timeline.zoomIn',
      title: (d) => c(d).zoomIn,
      category: 'view',
      icon: ZoomIn,
      enabled: () => getTimelineRuntime() !== null,
      run: () => getTimelineRuntime()?.zoomBy(1.5),
    },
    {
      id: 'timeline.zoomOut',
      title: (d) => c(d).zoomOut,
      category: 'view',
      icon: ZoomOut,
      enabled: () => getTimelineRuntime() !== null,
      run: () => getTimelineRuntime()?.zoomBy(1 / 1.5),
    },
    {
      id: 'timeline.zoomFit',
      title: (d) => c(d).zoomFit,
      category: 'view',
      icon: UnfoldHorizontal,
      enabled: () => getTimelineRuntime() !== null,
      run: () => getTimelineRuntime()?.zoomFit(),
    },
    {
      id: 'timeline.focus',
      title: (d) => c(d).focusTimeline,
      category: 'view',
      icon: GanttChart,
      keywords: ['timeline', 'keyboard', 'focus', 'таймлайн', 'клавиатура'],
      enabled: hasDocument,
      run: focusTimeline,
    },
    {
      id: 'timeline.toggleUnits',
      title: (d) => c(d).toggleUnits,
      category: 'view',
      keywords: ['seconds', 'frames', 'timecode', 'секунды', 'кадры'],
      checked: () => useTimelinePrefs.getState().units === 'seconds',
      run: () =>
        setTimelinePrefs({
          units: useTimelinePrefs.getState().units === 'seconds' ? 'frames' : 'seconds',
        }),
    },
    {
      id: 'timeline.toggleSnapping',
      title: (d) => c(d).toggleSnapping,
      category: 'view',
      keywords: ['snap', 'magnet', 'привязка'],
      checked: () => useTimelinePrefs.getState().snapping,
      run: () => setTimelinePrefs({ snapping: !useTimelinePrefs.getState().snapping }),
    },

    /* ------------------------------ Graph editor ------------------------------ */
    {
      id: 'timeline.toggleGraph',
      title: (d) => c(d).toggleGraph,
      category: 'view',
      icon: ChartSpline,
      shortcut: 'shift+f3',
      keywords: [
        'graph editor',
        'curves',
        'value graph',
        'speed graph',
        'velocity',
        'easing',
        'редактор диаграмм',
        'кривые',
        'график',
        'скорость',
      ],
      checked: () => useTimelinePrefs.getState().graph,
      enabled: hasDocument,
      run: () => toggleGraph(),
    },
    {
      id: 'timeline.graphValue',
      title: (d) => c(d).graphValue,
      category: 'view',
      icon: ChartSpline,
      keywords: ['graph editor', 'curves', 'диаграмма значений'],
      checked: () => {
        const p = useTimelinePrefs.getState()
        return p.graph && p.graphMode === 'value'
      },
      enabled: hasDocument,
      run: () => showGraphMode('value'),
    },
    {
      id: 'timeline.graphSpeed',
      title: (d) => c(d).graphSpeed,
      category: 'view',
      icon: Gauge,
      keywords: ['graph editor', 'velocity', 'influence', 'диаграмма скорости', 'влияние'],
      checked: () => {
        const p = useTimelinePrefs.getState()
        return p.graph && p.graphMode === 'speed'
      },
      enabled: hasDocument,
      run: () => showGraphMode('speed'),
    },
    {
      id: 'timeline.graphNormalize',
      title: (d) => c(d).graphNormalize,
      category: 'view',
      keywords: ['graph editor', 'normalize', 'нормализовать'],
      checked: () => useTimelinePrefs.getState().graphNormalize,
      run: toggleGraphNormalize,
    },
    {
      id: 'timeline.graphFit',
      title: (d) => c(d).graphFit,
      category: 'view',
      keywords: ['graph editor', 'auto-zoom', 'fit', 'height', 'вписать'],
      checked: () => useTimelineView.getState().graphFit,
      enabled: () => useTimelinePrefs.getState().graph,
      run: toggleGraphFit,
    },
  ]

  const disposers = [registerCommands(commands), registerPasteHandler(onPaste, 20)]
  return () => disposers.forEach((dispose) => dispose())
}
