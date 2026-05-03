// Confirmation dialog for the Shopping screen's "Regenerate from this
// week's meals" action. Wraps the generic Modal in a small,
// purpose-specific component so the Shopping screen can stay declarative.
//
// The merge contract is enforced by the backend (see
// server/services/shopping-list.service.js generateForWeek). The dialog
// surfaces the user-visible promise of that contract: bought + manual
// rows are kept, new ingredients from the current meal plan are added.

import { useTranslation } from 'react-i18next';
import { Modal } from '../overlay/Modal';
import { Button } from '../base/Button';

export interface RegenerateDialogProps {
  /** Whether the dialog is currently visible. Controlled by the parent. */
  open: boolean;
  /** Fires when the user dismisses the dialog without confirming. */
  onClose: () => void;
  /** Fires when the user confirms regeneration. */
  onConfirm: () => void | Promise<void>;
  /** When true, the confirm button shows a loading spinner and is disabled. */
  loading?: boolean;
}

export function RegenerateDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
}: RegenerateDialogProps): JSX.Element {
  const { t } = useTranslation('shopping');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('regenerateDialog.title')}
      description={t('regenerateDialog.description')}
      size="sm"
    >
      <div
        className="flex flex-col gap-3 sm:flex-row sm:justify-end"
        data-testid="regenerate-dialog-actions"
      >
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          disabled={loading}
          data-testid="regenerate-dialog-cancel"
        >
          {t('regenerateDialog.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => void onConfirm()}
          loading={loading}
          data-testid="regenerate-dialog-confirm"
        >
          {t('regenerateDialog.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
