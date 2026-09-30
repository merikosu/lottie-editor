import type { Animation } from '@/lottie/types'
import type { RendererType } from '@/store/prefs'
import type { WorkArea } from '@/store/playback'
import type { ExportPrefs } from '../../store'
import type { ExportModel } from '../model'

/** What every options panel receives from the dialog. */
export interface PanelProps {
  doc: Animation
  prefs: ExportPrefs
  model: ExportModel
  workArea: WorkArea | null
  /** Frame of the single-frame formats. */
  frame: number
  onFrame: (frame: number) => void
  /** The canvas view's renderer ("Like the canvas" option). */
  viewRenderer: RendererType
  /** Output file name (embed snippets reference it). */
  fileName: string
  /** The document uses expressions that the preview does not run. */
  expressionsOff: boolean
  /** The document being edited (`doc` is the still frame while one is exported). */
  source: Animation
  /** Lottie formats: export one frame as a still Lottie instead of the animation. */
  still: boolean
  onStill: (still: boolean) => void
  /** What the still frame left out (null when no still is exported). */
  stillInfo: { expressions: number; lostAutoOrient: number } | null
}
