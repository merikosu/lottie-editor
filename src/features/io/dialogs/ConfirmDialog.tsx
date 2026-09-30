import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Dialog } from '@/components/ui'
import { useT } from '@/i18n'
import { answerConfirm } from '../confirm'
import type { ConfirmChoice, ConfirmProps } from '../dialog-ids'

/**
 * Small confirmation used before destructive file actions (revert, discard changes). It only
 * renders the question: the answer goes back through `answerConfirm`, which also closes it.
 */
export function ConfirmDialog({ props }: DialogComponentProps<ConfirmProps>) {
  const t = useT()
  const answer = (choice: ConfirmChoice) => answerConfirm(props.token, choice)
  const danger = props.tone === 'danger'

  return (
    <Dialog
      // A newer question replacing this one gets a fresh dialog (and the default focus again).
      key={props.token}
      open
      onOpenChange={(open) => !open && answer('cancel')}
      size="sm"
      title={props.title}
      description={props.description}
      footer={
        <>
          {/* A destructive action never gets the default focus: Enter must not discard work. */}
          <Button variant="ghost" autoFocus={danger} onClick={() => answer('cancel')}>
            {t.common.cancel}
          </Button>
          {props.secondaryLabel && (
            <Button variant="secondary" onClick={() => answer('secondary')}>
              {props.secondaryLabel}
            </Button>
          )}
          <Button
            variant={danger ? 'danger' : 'primary'}
            autoFocus={!danger}
            data-testid="confirm-action"
            onClick={() => answer('confirm')}
          >
            {props.confirmLabel}
          </Button>
        </>
      }
    />
  )
}
