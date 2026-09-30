/** Embed code: snippet flavor, player options and the read-only code with a copy button. */
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton, SegmentedControl } from '@/components/ui'
import { INLINE_WARN_BYTES, isInline, type EmbedFlavor, type EmbedOptions } from '@/export/embed'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { copyText } from '@/lib/clipboard'
import { useFormatter } from '../../format'
import { updateFormatPrefs } from '../../store'
import { Note, OptionRow, OptionStack } from '../fields'
import { SwitchField } from './common'
import type { PanelProps } from './types'

/* -------------------------------------------------------------------------- */
/*                                  Code view                                 */
/* -------------------------------------------------------------------------- */

const TOKEN =
  /(<!--[\s\S]*?-->|\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(<\/?[a-zA-Z][\w-]*|\/?>)|\b(import|from|export|default|function|return|const|true|false|null)\b|(\b\d+(?:\.\d+)?\b)|([a-zA-Z_][\w-]*)(?==)/g

const CLASSES = [
  'text-fg-faint',
  'text-accent-text',
  'text-label-precomp',
  'text-label-precomp',
  'text-warning',
  'text-fg-muted',
]

/** Minimal highlighting for HTML/JSX snippets (tags, attributes, strings, keywords). */
function highlight(code: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const match of code.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > last) out.push(code.slice(last, index))
    const group = match.slice(1).findIndex((g) => g !== undefined)
    out.push(
      <span key={`${key}-${n++}`} className={CLASSES[group]}>
        {match[0]}
      </span>,
    )
    last = index + match[0].length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

function CopyButton({ onCopy, label }: { onCopy: () => Promise<boolean>; label: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={copied ? t.export.copied : label}
      className={cn('bg-surface-2', copied && 'text-success hover:text-success')}
      onClick={async () => {
        if (await onCopy()) {
          setCopied(true)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1400)
        }
      }}
    />
  )
}

/** Read-only code with a copy button; `placeholder` marks where a collapsed chip is shown. */
export function CodeBlock({
  code,
  placeholder,
  placeholderLabel,
  onCopy,
  className,
  testId,
}: {
  code: string
  placeholder?: string | null
  placeholderLabel?: string
  onCopy: () => Promise<boolean>
  className?: string
  testId?: string
}) {
  const t = useT()
  const parts = placeholder ? code.split(placeholder) : [code]
  return (
    <div
      className={cn(
        'group relative min-h-0 rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--le-line)]',
        className,
      )}
      data-testid={testId}
    >
      <pre className="selectable h-full overflow-auto px-3 py-2.5 font-mono text-xs leading-[18px] whitespace-pre text-fg">
        <code>
          {parts.map((part, i) => (
            <span key={i}>
              {highlight(part, `p${i}`)}
              {i < parts.length - 1 && (
                <span className="mx-0.5 inline-flex h-4 items-center rounded-sm bg-hover px-1.5 font-sans text-2xs text-fg-muted">
                  {placeholderLabel}
                </span>
              )}
            </span>
          ))}
        </code>
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton onCopy={onCopy} label={t.export.copy} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Panel                                   */
/* -------------------------------------------------------------------------- */

const set = (patch: Partial<EmbedOptions>) => updateFormatPrefs('embed', patch)

export function EmbedPanel({
  model,
  prefs,
  fileName,
  onCopyCode,
}: PanelProps & { onCopyCode: () => Promise<boolean> }) {
  const t = useT()
  const fmt = useFormatter()
  const o = prefs.embed
  const snippet = model.embed
  const inline = isInline(o)
  const jsonBytes = o.flavor === 'wc' ? undefined : model.embedBytes.value
  const hint =
    o.flavor === 'html'
      ? t.export.embed.htmlHint
      : o.flavor === 'wc'
        ? t.export.embed.wcHint
        : t.export.embed.reactHint
  return (
    <OptionStack className="h-full min-h-0">
      <div className="flex flex-col gap-1.5">
        <SegmentedControl<EmbedFlavor>
          value={o.flavor}
          onValueChange={(flavor) => set({ flavor })}
          size="md"
          className="w-fit"
          aria-label={t.export.fields.code}
          options={[
            { value: 'html', label: t.export.embed.html },
            { value: 'wc', label: t.export.embed.wc },
            { value: 'react', label: t.export.embed.react },
          ]}
        />
        <span className="text-xs text-fg-subtle">{hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
        <OptionRow label={t.export.fields.loop} className="grid-cols-[88px_minmax(0,1fr)]">
          <SwitchField checked={o.loop} onChange={(loop) => set({ loop })}>
            {t.export.playerLoop}
          </SwitchField>
        </OptionRow>
        <OptionRow label={t.export.fields.autoplay} className="grid-cols-[88px_minmax(0,1fr)]">
          <SwitchField checked={o.autoplay} onChange={(autoplay) => set({ autoplay })}>
            {t.export.playerAutoplay}
          </SwitchField>
        </OptionRow>
        {o.flavor !== 'wc' && (
          <OptionRow label={t.export.fields.renderer} className="grid-cols-[88px_minmax(0,1fr)]">
            <SegmentedControl<'svg' | 'canvas'>
              value={o.renderer}
              onValueChange={(renderer) => set({ renderer })}
              size="md"
              aria-label={t.export.fields.renderer}
              options={[
                { value: 'svg', label: t.export.renderers.svg },
                { value: 'canvas', label: t.export.renderers.canvas },
              ]}
            />
          </OptionRow>
        )}
        {o.flavor === 'html' && (
          <OptionRow label={t.export.fields.json} className="grid-cols-[88px_minmax(0,1fr)]">
            <SwitchField
              checked={o.inline}
              onChange={(v) => set({ inline: v })}
              testId="export-embed-inline"
            >
              {t.export.embed.inline}
            </SwitchField>
          </OptionRow>
        )}
      </div>
      {inline ? (
        jsonBytes !== undefined && jsonBytes > INLINE_WARN_BYTES ? (
          <Note tone="warning">{t.export.embed.inlineWarning(fmt.size(jsonBytes))}</Note>
        ) : (
          <Note>{t.export.embed.inlineHint}</Note>
        )
      ) : (
        <Note>
          {o.flavor === 'react'
            ? t.export.embed.importHint(fileName)
            : t.export.embed.hostHint(fileName)}
        </Note>
      )}
      {snippet?.install && (
        <CodeBlock
          code={snippet.install}
          onCopy={() => copyText(snippet.install!)}
          className="h-[38px] shrink-0"
          testId="export-embed-install"
        />
      )}
      {snippet && (
        <CodeBlock
          code={snippet.preview}
          placeholder={snippet.placeholder}
          placeholderLabel={t.export.embed.jsonPlaceholder(
            jsonBytes !== undefined ? fmt.size(jsonBytes) : '…',
          )}
          onCopy={onCopyCode}
          className="min-h-[120px] flex-1"
          testId="export-embed-code"
        />
      )}
    </OptionStack>
  )
}
