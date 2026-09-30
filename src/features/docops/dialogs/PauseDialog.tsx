import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Dialog } from '@/components/ui'
import { useT } from '@/i18n'
import { addPause } from '../actions'
import { PauseForm } from '../components/PauseForm'
import { useConfirmKey, useInitialFocus } from '../hooks'
import { useDocopsPrefs } from '../store'

/** "Add pause at end…": hold the last frame for a while before the loop restarts. */
export function PauseDialog({ close }: DialogComponentProps) {
  const t = useT()
  const { ref: fields, onOpenAutoFocus } = useInitialFocus<HTMLDivElement>()
  const apply = () => {
    if (addPause(useDocopsPrefs.getState().pauseSeconds)) close()
  }
  useConfirmKey(fields, apply)
  return (
    <Dialog
      open
      onOpenAutoFocus={onOpenAutoFocus}
      onOpenChange={(open) => !open && close()}
      title={t.docops.pause.title}
      description={t.docops.pause.description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={apply} data-testid="docops-pause-apply">
            {t.docops.pause.add}
          </Button>
        </>
      }
    >
      <div ref={fields}>
        <PauseForm />
      </div>
    </Dialog>
  )
}
