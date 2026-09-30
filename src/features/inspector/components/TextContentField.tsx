/**
 * Multi-line text content field. Typing updates the document live (throttled) and one
 * focus session is one undo step, however long the pauses: every update of the session is
 * an in-progress gesture update, the last one (on blur) closes it. It takes focus when
 * another feature emits `edit-text` for its layer (`focusKey` = the layer's path key).
 */
import { useEffect, useRef, useState } from 'react'
import { TextArea, type ChangeGesture } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/id'
import { throttle } from '@/lib/timing'
import { requestTextFocus, useInspectorRequests } from '../state'

interface TextContentFieldProps {
  /** Editor text ("\n" line breaks). */
  value: string
  onChange: (text: string, gesture: ChangeGesture) => void
  focusKey?: string
  maxRows?: number
  className?: string
  'aria-label'?: string
}

export function TextContentField({
  value,
  onChange,
  focusKey,
  maxRows = 8,
  className,
  ...rest
}: TextContentFieldProps) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const session = useRef(uid('text'))
  // True once the user typed in this focus session (a plain focus + blur must not write).
  const typed = useRef(false)
  const focusRequest = useInspectorRequests((s) => s.focusText)

  // The throttled writer lives for the whole mount and always calls the latest onChange.
  const onChangeRef = useRef(onChange)
  const pushRef = useRef<((text: string, gesture: ChangeGesture) => void) & { flush: () => void }>(
    null,
  )
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    const push = throttle(
      (text: string, gesture: ChangeGesture) => onChangeRef.current(text, gesture),
      120,
    )
    pushRef.current = push
    return () => {
      push.flush()
      pushRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!focusKey || focusRequest !== focusKey) return
    requestTextFocus(null)
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
    el.scrollIntoView({ block: 'nearest' })
  }, [focusRequest, focusKey])

  const text = draft ?? value
  const rows = Math.min(maxRows, Math.max(2, text.split('\n').length))

  return (
    <TextArea
      ref={ref}
      rows={rows}
      value={text}
      placeholder={t.inspector.text.contentPlaceholder}
      aria-label={rest['aria-label'] ?? t.inspector.text.content}
      spellCheck
      onFocus={() => {
        session.current = uid('text')
        typed.current = false
        setDraft(value)
      }}
      onChange={(e) => {
        typed.current = true
        setDraft(e.target.value)
        pushRef.current?.(e.target.value, { key: session.current, final: false })
      }}
      onBlur={() => {
        pushRef.current?.flush()
        // Closes the session's undo step (a no-op write when the text is already applied).
        if (typed.current && draft !== null)
          onChangeRef.current(draft, { key: session.current, final: true })
        typed.current = false
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className={cn('min-h-12 resize-none leading-4', className)}
    />
  )
}
