import { useCallback, useEffect } from 'react'
import { nodeDisplayName } from '@/components/lottie/labels'
import { useT } from '@/i18n'
import type { NodePath } from '@/lottie/path'
import { getDoc, useDocument } from '@/store/document'
import { pause, play } from '@/store/playback'
import { resolvePick } from './lib/targets'
import { ColorsSection } from './panel/ColorsSection'
import { LogosSection } from './panel/LogosSection'
import { DocumentHeader, ExportFooter } from './panel/PanelParts'
import { TextsSection } from './panel/TextsSection'
import { TimingSection } from './panel/TimingSection'
import { useSuggestions } from './panel/useElements'
import { Preview } from './preview/Preview'
import { openReplace } from './replace/open'
import { StartState } from './StartState'
import { useCustomizeUi } from './store'

/** The animation plays while the page is up (and again for every newly opened file). */
function usePlayWhileShown(): void {
  const docId = useDocument((s) => s.meta?.id)
  useEffect(() => {
    if (docId) play()
  }, [docId])
  useEffect(() => () => pause(), [])
}

function Workspace() {
  const t = useT()
  const replacing = useCustomizeUi((s) => s.replacing)
  const { items, stale } = useSuggestions(replacing)
  usePlayWhileShown()

  const pick = useCallback(
    (stack: NodePath[], deep: boolean) => {
      const doc = getDoc()
      // Suggestions of a document with other layers would prefer the wrong elements.
      return doc ? resolvePick(doc, stack, stale ? [] : items, deep) : null
    },
    [items, stale],
  )
  const nameOf = useCallback(
    (path: NodePath) => {
      const doc = getDoc()
      return doc ? nodeDisplayName(doc, path, t) : ''
    },
    [t],
  )

  return (
    <div className="flex h-full min-h-0" data-testid="customize">
      <Preview
        className="min-w-[320px] flex-1"
        pick={pick}
        nameOf={nameOf}
        onActivate={(path) => openReplace(path)}
      />
      <aside
        aria-label={t.customize.title}
        className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface-1"
        data-testid="customize-panel"
      >
        <DocumentHeader />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LogosSection />
          <ColorsSection />
          <TextsSection />
          <TimingSection />
        </div>
        <ExportFooter />
      </aside>
    </div>
  )
}

/** Customize service: replace logos and images, brand colors, texts, timing, export. */
export function CustomizePage() {
  const hasDoc = useDocument((s) => s.doc !== null)
  return hasDoc ? <Workspace /> : <StartState />
}
