import { CircleAlert, Link2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Dialog, Spinner, TextInput } from '@/components/ui'
import { useLanguage, useT } from '@/i18n'
import type { OpenUrlProps } from '../dialog-ids'
import { normalizeUrl } from '../fetchUrl'
import { formatFileSize } from '../format'
import {
  cancelUrlDownload,
  resetUrlDownload,
  startUrlDownload,
  useUrlDownload,
} from '../urlDownload'

/** "Open from URL…": downloads a Lottie file with progress and explains failures (CORS). */
export function OpenUrlDialog({ props, close }: DialogComponentProps<OpenUrlProps | undefined>) {
  const t = useT()
  const language = useLanguage()
  const [value, setValue] = useState(props?.url ?? '')
  const state = useUrlDownload((s) => s.state)
  const normalized = normalizeUrl(value)
  const loading = state.kind === 'loading'
  const size = (bytes: number) => formatFileSize(bytes, language, t.io.units)

  const dismiss = () => {
    cancelUrlDownload()
    close()
  }

  // Invalid links are explained on submit (a silently disabled button would not say why).
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!loading && value.trim()) startUrlDownload(value)
  }

  const onChange = (next: string) => {
    setValue(next)
    // An error is about the link that was tried: editing it starts over.
    if (state.kind === 'error') resetUrlDownload()
  }

  let status: string | null = null
  if (state.kind === 'loading') {
    status =
      state.phase === 'connecting'
        ? t.io.openUrl.connecting
        : state.phase === 'reading'
          ? t.io.openUrl.reading
          : t.io.openUrl.downloading(size(state.loaded), state.total ? size(state.total) : null)
  }
  const progress =
    state.kind !== 'loading'
      ? 0
      : state.phase === 'reading'
        ? 1
        : state.total
          ? Math.min(1, state.loaded / state.total)
          : 0.08

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && dismiss()}
      size="md"
      title={t.io.openUrl.title}
      description={t.io.openUrl.description}
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            {t.common.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="le-open-url"
            disabled={!value.trim() || loading}
            data-testid="open-url-submit"
          >
            {t.io.openUrl.open}
          </Button>
        </>
      }
    >
      {/* noValidate: bare hosts ("lottie.host/…") are valid here, not for the browser's url check. */}
      <form id="le-open-url" noValidate onSubmit={onSubmit} className="flex flex-col">
        <TextInput
          size="md"
          icon={Link2}
          value={value}
          autoFocus
          type="url"
          inputMode="url"
          placeholder={t.io.openUrl.placeholder}
          aria-label={t.io.openUrl.title}
          aria-invalid={state.kind === 'error' || undefined}
          // Read-only (not disabled) while downloading, so it keeps the focus.
          readOnly={loading}
          className={loading ? 'text-fg-muted' : undefined}
          onChange={(e) => onChange(e.target.value)}
          data-testid="open-url-input"
        />
        <div className="mt-2.5 min-h-10" aria-live="polite">
          {state.kind === 'loading' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs text-fg-muted tabular-nums">
                <Spinner size={12} />
                <span className="truncate">{status}</span>
              </div>
              <div className="h-0.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150 ease-out"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}
          {state.kind === 'error' && (
            <div
              className="flex items-start gap-2 rounded-md bg-danger-subtle px-2.5 py-2 text-xs text-danger"
              role="alert"
              data-testid="open-url-error"
            >
              <CircleAlert size={14} className="mt-px shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">{state.message.title}</div>
                {state.message.lines.map((line, i) => (
                  <div key={i} className="mt-0.5 text-fg-muted">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
          {state.kind === 'idle' && normalized?.rewritten && (
            <div className="text-xs text-fg-subtle">{t.io.openUrl.githubRewritten}</div>
          )}
        </div>
      </form>
    </Dialog>
  )
}
