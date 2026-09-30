import type { DialogComponentProps } from '@/commands/dialogs'
import { Dialog } from '@/components/ui'
import { useT } from '@/i18n'
import { usePrefs } from '@/store/prefs'
import { openSample } from '../open'
import { SampleGrid } from '../SampleGrid'

/** The welcome screen's sample grid, for when a document is already open. */
export function SamplesDialog({ close }: DialogComponentProps<undefined>) {
  const t = useT()
  // Without autosave the replaced animation does not go to Recent.
  const autosave = usePrefs((s) => s.autosave)
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      // Wide enough for the welcome screen's four columns: every sample fits without scrolling.
      size="xl"
      title={t.io.samples.dialogTitle}
      description={
        autosave ? t.io.samples.dialogDescription : t.io.samples.dialogDescriptionNoAutosave
      }
      bodyClassName="pt-1"
    >
      <SampleGrid
        autoFocus
        onOpen={(id) => {
          close()
          void openSample(id)
        }}
      />
    </Dialog>
  )
}
