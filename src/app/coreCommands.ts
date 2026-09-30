/**
 * Commands owned by the app shell: history, playback, view and preferences.
 * Feature-specific commands are registered by each feature's register.ts.
 */
import {
  ChevronFirst,
  ChevronLast,
  Code2,
  Columns2,
  Command as CommandIcon,
  Frame,
  Gauge,
  Home,
  Moon,
  Paintbrush,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pause,
  PenTool,
  Redo2,
  Repeat,
  StepBack,
  StepForward,
  Sun,
  SunMoon,
  Undo2,
} from 'lucide-react'
import { registerCommands, type Command } from '@/commands/registry'
import { setLanguage } from '@/i18n'
import { canRedo, canUndo, clearSelection, getDoc, redo, undo, useDocument } from '@/store/document'
import {
  SPEEDS,
  cyclePlayMode,
  goToEnd,
  goToStart,
  goToWorkAreaEnd,
  goToWorkAreaStart,
  setPlayMode,
  setSpeed,
  setWorkArea,
  setWorkAreaEnd,
  setWorkAreaStart,
  stepFrames,
  togglePlay,
  usePlayback,
} from '@/store/playback'
import { setPrefs, usePrefs } from '@/store/prefs'
import { setCommandPaletteOpen } from '@/store/ui'
import { layout } from './layout'
import { currentRoute, navigate } from './router'
import { resolveTheme } from './theme'

const hasDoc = () => getDoc() !== null

export function registerCoreCommands(): () => void {
  const commands: Command[] = [
    /* --------------------------------- Edit --------------------------------- */
    {
      id: 'edit.undo',
      title: (t) => t.commands.undo,
      category: 'edit',
      icon: Undo2,
      shortcut: 'mod+z',
      repeat: true,
      allowInPopover: true,
      enabled: canUndo,
      run: () => void undo(),
    },
    {
      id: 'edit.redo',
      title: (t) => t.commands.redo,
      category: 'edit',
      icon: Redo2,
      shortcut: ['mod+shift+z', 'mod+y'],
      repeat: true,
      allowInPopover: true,
      enabled: canRedo,
      run: () => void redo(),
    },
    {
      id: 'edit.deselect',
      title: (t) => t.commands.deselect,
      category: 'edit',
      shortcut: 'escape',
      enabled: () => {
        const sel = useDocument.getState().selection
        return sel.nodes.length > 0 || sel.keyframes.length > 0
      },
      run: clearSelection,
    },

    /* ------------------------------- Playback ------------------------------- */
    {
      id: 'playback.toggle',
      title: (t) => t.commands.playPause,
      category: 'playback',
      icon: Pause,
      shortcut: 'space',
      enabled: hasDoc,
      run: togglePlay,
    },
    {
      id: 'playback.nextFrame',
      title: (t) => t.commands.nextFrame,
      category: 'playback',
      icon: StepForward,
      shortcut: ['right', '.'],
      repeat: true,
      enabled: hasDoc,
      run: () => stepFrames(1),
    },
    {
      id: 'playback.prevFrame',
      title: (t) => t.commands.prevFrame,
      category: 'playback',
      icon: StepBack,
      shortcut: ['left', ','],
      repeat: true,
      enabled: hasDoc,
      run: () => stepFrames(-1),
    },
    {
      id: 'playback.forward10',
      title: (t) => t.commands.forward10,
      category: 'playback',
      shortcut: ['shift+right', 'shift+.'],
      repeat: true,
      enabled: hasDoc,
      run: () => stepFrames(10),
    },
    {
      id: 'playback.back10',
      title: (t) => t.commands.back10,
      category: 'playback',
      shortcut: ['shift+left', 'shift+,'],
      repeat: true,
      enabled: hasDoc,
      run: () => stepFrames(-10),
    },
    {
      id: 'playback.start',
      title: (t) => t.commands.goToStart,
      category: 'playback',
      icon: ChevronFirst,
      shortcut: 'home',
      enabled: hasDoc,
      run: goToStart,
    },
    {
      id: 'playback.end',
      title: (t) => t.commands.goToEnd,
      category: 'playback',
      icon: ChevronLast,
      shortcut: 'end',
      enabled: hasDoc,
      run: goToEnd,
    },
    {
      id: 'playback.workStart',
      title: (t) => t.commands.goToWorkStart,
      category: 'playback',
      shortcut: 'shift+home',
      enabled: hasDoc,
      run: goToWorkAreaStart,
    },
    {
      id: 'playback.workEnd',
      title: (t) => t.commands.goToWorkEnd,
      category: 'playback',
      shortcut: 'shift+end',
      enabled: hasDoc,
      run: goToWorkAreaEnd,
    },
    {
      id: 'playback.setWorkStart',
      title: (t) => t.commands.setWorkStart,
      category: 'playback',
      shortcut: ['i', 'b'],
      enabled: hasDoc,
      run: () => setWorkAreaStart(),
    },
    {
      id: 'playback.setWorkEnd',
      title: (t) => t.commands.setWorkEnd,
      category: 'playback',
      shortcut: ['o', 'n'],
      enabled: hasDoc,
      run: () => setWorkAreaEnd(),
    },
    {
      id: 'playback.clearWorkArea',
      title: (t) => t.commands.clearWorkArea,
      category: 'playback',
      shortcut: 'alt+x',
      enabled: () => usePlayback.getState().workArea !== null,
      run: () => setWorkArea(null),
    },
    {
      id: 'playback.cycleMode',
      title: (t) => t.commands.cyclePlayMode,
      category: 'playback',
      icon: Repeat,
      shortcut: 'shift+l',
      run: cyclePlayMode,
    },
    {
      id: 'playback.mode.loop',
      title: (t) => t.commands.modeLoop,
      category: 'playback',
      hidden: true,
      checked: () => usePlayback.getState().mode === 'loop',
      run: () => setPlayMode('loop'),
    },
    {
      id: 'playback.mode.once',
      title: (t) => t.commands.modeOnce,
      category: 'playback',
      hidden: true,
      checked: () => usePlayback.getState().mode === 'once',
      run: () => setPlayMode('once'),
    },
    {
      id: 'playback.mode.bounce',
      title: (t) => t.commands.modeBounce,
      category: 'playback',
      hidden: true,
      checked: () => usePlayback.getState().mode === 'bounce',
      run: () => setPlayMode('bounce'),
    },
    ...SPEEDS.map<Command>((s) => ({
      id: `playback.speed.${s}`,
      title: (t) => t.commands.speed(`${s}×`),
      category: 'playback',
      hidden: s !== 0.5 && s !== 1 && s !== 2,
      checked: () => usePlayback.getState().speed === s,
      run: () => setSpeed(s),
    })),

    /* --------------------------------- View --------------------------------- */
    {
      id: 'view.toggleUi',
      title: (t) => t.commands.toggleUi,
      category: 'view',
      shortcut: 'mod+\\',
      run: () => {
        const l = layout()
        const anyVisible = !l.isLeftCollapsed() || !l.isRightCollapsed()
        if (anyVisible) {
          if (!l.isLeftCollapsed()) l.toggleLeft()
          if (!l.isRightCollapsed()) l.toggleRight()
        } else {
          l.toggleLeft()
          l.toggleRight()
        }
      },
    },
    {
      id: 'view.toggleLeft',
      title: (t) => t.commands.toggleLeftPanel,
      category: 'view',
      icon: PanelLeft,
      shortcut: 'mod+alt+1',
      keywords: ['toggle', 'hide', 'panel', 'скрыть', 'панель'],
      checked: () => !layout().isLeftCollapsed(),
      run: () => layout().toggleLeft(),
    },
    {
      id: 'view.toggleRight',
      title: (t) => t.commands.toggleRightPanel,
      category: 'view',
      icon: PanelRight,
      shortcut: 'mod+alt+2',
      keywords: ['toggle', 'hide', 'panel', 'скрыть', 'панель'],
      checked: () => !layout().isRightCollapsed(),
      run: () => layout().toggleRight(),
    },
    {
      id: 'view.toggleTimeline',
      title: (t) => t.commands.toggleTimeline,
      category: 'view',
      icon: PanelBottom,
      shortcut: 'mod+alt+3',
      keywords: ['toggle', 'hide', 'panel', 'скрыть', 'панель'],
      checked: () => !layout().isBottomCollapsed(),
      run: () => layout().toggleBottom(),
    },
    {
      id: 'view.canvas',
      title: (t) => t.commands.showCanvas,
      category: 'view',
      icon: Frame,
      shortcut: 'mod+alt+c',
      checked: () => usePrefs.getState().centerView === 'canvas',
      run: () => setPrefs({ centerView: 'canvas' }),
    },
    {
      id: 'view.code',
      title: (t) => t.commands.showCode,
      category: 'view',
      icon: Code2,
      shortcut: 'mod+alt+j',
      checked: () => usePrefs.getState().centerView === 'code',
      run: () => setPrefs({ centerView: 'code' }),
    },
    {
      id: 'view.split',
      title: (t) => t.commands.showSplit,
      category: 'view',
      icon: Columns2,
      checked: () => usePrefs.getState().centerView === 'split',
      run: () => setPrefs({ centerView: 'split' }),
    },
    {
      id: 'view.renderer.svg',
      title: (t) => t.commands.rendererSvg,
      category: 'view',
      checked: () => usePrefs.getState().renderer === 'svg',
      run: () => setPrefs({ renderer: 'svg' }),
    },
    {
      id: 'view.renderer.canvas',
      title: (t) => t.commands.rendererCanvas,
      category: 'view',
      checked: () => usePrefs.getState().renderer === 'canvas',
      run: () => setPrefs({ renderer: 'canvas' }),
    },
    {
      id: 'view.theme.toggle',
      title: (t) => t.commands.toggleTheme,
      category: 'view',
      icon: SunMoon,
      shortcut: 'mod+alt+t',
      run: () => setPrefs((p) => ({ theme: resolveTheme(p.theme) === 'dark' ? 'light' : 'dark' })),
    },
    {
      id: 'view.theme.dark',
      title: (t) => t.commands.themeDark,
      category: 'view',
      icon: Moon,
      hidden: true,
      checked: () => usePrefs.getState().theme === 'dark',
      run: () => setPrefs({ theme: 'dark' }),
    },
    {
      id: 'view.theme.light',
      title: (t) => t.commands.themeLight,
      category: 'view',
      icon: Sun,
      hidden: true,
      checked: () => usePrefs.getState().theme === 'light',
      run: () => setPrefs({ theme: 'light' }),
    },
    {
      id: 'view.theme.system',
      title: (t) => t.commands.themeSystem,
      category: 'view',
      icon: SunMoon,
      hidden: true,
      checked: () => usePrefs.getState().theme === 'system',
      run: () => setPrefs({ theme: 'system' }),
    },
    {
      id: 'view.language.en',
      title: (t) => t.commands.languageEn,
      category: 'view',
      keywords: ['language', 'язык', 'english', 'английский', 'interface'],
      checked: () => usePrefs.getState().language === 'en',
      run: () => setLanguage('en'),
    },
    {
      id: 'view.language.ru',
      title: (t) => t.commands.languageRu,
      category: 'view',
      keywords: ['language', 'язык', 'russian', 'русский', 'interface'],
      checked: () => usePrefs.getState().language === 'ru',
      run: () => setLanguage('ru'),
    },

    /* ------------------------------- Services ------------------------------- */
    {
      id: 'app.home',
      title: (t) => t.app.services.home,
      category: 'view',
      icon: Home,
      run: () => navigate('home'),
    },
    {
      id: 'app.edit',
      title: (t) => t.app.services.edit,
      category: 'view',
      icon: PenTool,
      shortcut: 'alt+1',
      checked: () => currentRoute() === 'edit',
      run: () => navigate('edit'),
    },
    {
      id: 'app.customize',
      title: (t) => t.app.services.customize,
      category: 'view',
      icon: Paintbrush,
      shortcut: 'alt+2',
      checked: () => currentRoute() === 'customize',
      run: () => navigate('customize'),
    },
    {
      id: 'app.optimize',
      title: (t) => t.app.services.optimize,
      category: 'view',
      icon: Gauge,
      shortcut: 'alt+3',
      checked: () => currentRoute() === 'optimize',
      run: () => navigate('optimize'),
    },

    /* --------------------------------- Help --------------------------------- */
    {
      id: 'help.commandPalette',
      title: (t) => t.commands.commandPalette,
      category: 'help',
      icon: CommandIcon,
      shortcut: ['mod+k', 'mod+shift+p'],
      allowInInput: true,
      hidden: true,
      run: () => setCommandPaletteOpen(true),
    },
  ]
  return registerCommands(commands)
}
