import { ChevronDown, Download, PenTool } from 'lucide-react'
import { navigate } from '@/app/router'
import { primaryShortcut, runCommand, useCommand } from '@/commands/registry'
import { Button, Tooltip } from '@/components/ui'
import { formatDuration, TruncatedText } from '@/features/io'
import { useLanguage, useT } from '@/i18n'
import { isDotLottieContainer } from '@/lottie/dotlottie'
import { useDocument } from '@/store/document'

const SWITCH_ANIMATION = 'file.switchAnimation'

/**
 * The animation shown, for a .lottie that holds several: its name and place, opening the
 * picker to customize another one of them (the edits of this one stay in the file).
 */
function AnimationSwitch() {
  const t = useT()
  const container = useDocument((s) =>
    isDotLottieContainer(s.meta?.dotLottie) ? s.meta.dotLottie : null,
  )
  const docName = useDocument((s) => s.doc?.nm)
  const cmd = useCommand(SWITCH_ANIMATION)
  if (!container || container.animations.length < 2 || !cmd) return null
  const index = container.animations.findIndex((a) => a.id === container.activeId)
  const metaName = container.animations[index]?.meta.name
  const name =
    (typeof metaName === 'string' && metaName.trim()) || docName?.trim() || container.activeId
  const place = t.customize.header.animation(index + 1, container.animations.length)
  return (
    <Tooltip content={cmd.title(t)}>
      <button
        type="button"
        onClick={() => runCommand(SWITCH_ANIMATION)}
        aria-label={`${name}, ${place}`}
        aria-haspopup="dialog"
        className="-my-0.5 flex h-5 min-w-0 shrink items-center gap-1 rounded-sm px-1 text-sm text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg"
        data-testid="customize-switch-animation"
      >
        <span className="truncate">{name}</span>
        <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
          {index + 1}/{container.animations.length}
        </span>
        <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
      </button>
    </Tooltip>
  )
}

/** File name and facts of the open animation, with the way to the full editor. */
export function DocumentHeader() {
  const t = useT()
  const language = useLanguage()
  const fileName = useDocument((s) => s.meta?.fileName ?? '')
  const w = useDocument((s) => s.doc?.w ?? 0)
  const h = useDocument((s) => s.doc?.h ?? 0)
  const fr = useDocument((s) => s.doc?.fr ?? 0)
  const frames = useDocument((s) => (s.doc ? Math.max(0, s.doc.op - s.doc.ip) : 0))
  const details = [
    `${w} × ${h}`,
    `${fr} ${t.common.fps}`,
    `${formatDuration(frames, fr, language)} ${t.common.secondsShort}`,
  ].join(' · ')
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-0.5">
          <TruncatedText text={fileName} className="shrink text-sm font-medium text-fg" />
          <AnimationSwitch />
        </div>
        <span className="truncate text-xs text-fg-subtle tabular-nums">{details}</span>
      </div>
      <Tooltip content={t.customize.header.openInEditorHint}>
        <Button
          variant="ghost"
          size="sm"
          icon={PenTool}
          onClick={() => navigate('edit')}
          data-testid="customize-open-editor"
        >
          {t.customize.header.openInEditor}
        </Button>
      </Tooltip>
    </div>
  )
}

const QUICK_FORMATS: { id: string; label: string }[] = [
  { id: 'export.json', label: 'JSON' },
  { id: 'export.dotlottie', label: '.lottie' },
  { id: 'export.gif', label: 'GIF' },
  { id: 'export.mp4', label: 'MP4' },
]

function QuickFormat({ id, label }: { id: string; label: string }) {
  const t = useT()
  const cmd = useCommand(id)
  if (!cmd) return null
  return (
    <Tooltip content={cmd.title(t)}>
      <Button size="sm" variant="secondary" onClick={() => runCommand(id)} className="min-w-0 px-1">
        {label}
      </Button>
    </Tooltip>
  )
}

/** The last step: the export dialog, or straight to a common format. */
export function ExportFooter() {
  const t = useT()
  const exportCmd = useCommand('file.export')
  return (
    <div
      className="flex shrink-0 flex-col gap-2 border-t border-line px-3 pt-2.5 pb-3"
      data-testid="customize-export"
    >
      <div className="text-xs text-fg-subtle">{t.customize.export.formats}</div>
      <div className="grid grid-cols-4 gap-1">
        {QUICK_FORMATS.map((f) => (
          <QuickFormat key={f.id} id={f.id} label={f.label} />
        ))}
      </div>
      {exportCmd && (
        <Tooltip content={exportCmd.title(t)} shortcut={primaryShortcut(exportCmd)}>
          <Button
            variant="primary"
            icon={Download}
            onClick={() => runCommand('file.export')}
            className="w-full"
          >
            {t.customize.export.exportAll}
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
