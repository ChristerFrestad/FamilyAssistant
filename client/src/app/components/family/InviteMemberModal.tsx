// Sprint 9 / PR #119 — Invite-member modal.
//
// Three fields: email (required, validated client-side), role (read-only
// "Voksen" tag for pilot — backend supports 'adult'|'child' but children
// onboard via subaccount-PIN in Sprint 10, so the radio is omitted to
// keep the surface unambiguous), and an optional 500-char personal
// message with a live character counter.
//
// On submit it calls familyInvitationsApi.createInvitation and dispatches
// the response back to the parent via onSuccess. The 409
// EMAIL_ALREADY_MEMBER and EMAIL_ALREADY_INVITED codes map to inline
// errors under the email field; everything else maps to a generic toast
// inside the modal so the user does not lose their typed message.
//
// Locale: the modal forwards `i18n.language` so the email arrives in the
// language the inviter is currently using. Backend stores it on the row
// for resend.

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../overlay/Modal';
import { Button } from '../base/Button';
import { Input } from '../form/Input';
import { Field } from '../form/Field';
import {
  createInvitation,
  FamilyInvitationsApiError,
  type Invitation,
  type InvitationLocale,
} from '../../family/familyInvitationsApi';

const MAX_MESSAGE = 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (invitation: Invitation) => void;
}

export function InviteMemberModal({
  open,
  onClose,
  onSuccess,
}: InviteMemberModalProps): JSX.Element {
  const { t, i18n } = useTranslation('family');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);
  const messageId = useId();
  const messageCounterId = useId();
  const genericErrorRef = useRef<HTMLParagraphElement | null>(null);

  // Reset form whenever the modal closes so re-opening starts clean.
  useEffect(() => {
    if (!open) {
      setEmail('');
      setEmailTouched(false);
      setMessage('');
      setSubmitting(false);
      setEmailError(null);
      setGenericError(null);
    }
  }, [open]);

  const trimmedEmail = email.trim();
  const trimmedMessage = message.trim();
  const messageLength = trimmedMessage.length;
  const messageOverLimit = messageLength > MAX_MESSAGE;
  const emailIsBlank = trimmedEmail.length === 0;
  const emailIsValid = EMAIL_RE.test(trimmedEmail);
  const showLocalEmailError = emailTouched && !emailIsBlank && !emailIsValid;
  const inlineEmailError =
    emailError ?? (showLocalEmailError ? t('family:invitations.validation.invalidEmail') : null);
  const submitDisabled = submitting || emailIsBlank || !emailIsValid || messageOverLimit;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (submitDisabled) return;
    setEmailTouched(true);
    setSubmitting(true);
    setEmailError(null);
    setGenericError(null);
    try {
      const locale = (i18n.language?.startsWith('en') ? 'en' : 'no') as InvitationLocale;
      const r = await createInvitation({
        email: trimmedEmail,
        role: 'adult',
        invitationMessage: trimmedMessage === '' ? null : trimmedMessage,
        locale,
      });
      onSuccess(r.invitation);
      onClose();
    } catch (err) {
      if (err instanceof FamilyInvitationsApiError) {
        if (err.code === 'EMAIL_ALREADY_MEMBER') {
          setEmailError(t('family:invitations.validation.alreadyMember'));
        } else if (err.code === 'EMAIL_ALREADY_INVITED') {
          setEmailError(t('family:invitations.validation.alreadyInvited'));
        } else if (err.status === 400 && err.detail?.includes('500')) {
          setGenericError(t('family:invitations.validation.messageTooLong'));
        } else {
          setGenericError(t('family:invitations.validation.generic'));
        }
      } else {
        setGenericError(t('family:invitations.validation.generic'));
      }
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={t('family:invitations.modal.title')}
      size="md"
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label={t('family:invitations.modal.email')}
          required
          {...(inlineEmailError ? { error: inlineEmailError } : {})}
        >
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder={t('family:invitations.modal.emailPlaceholder')}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
            }}
            onBlur={() => setEmailTouched(true)}
            disabled={submitting}
            data-testid="invite-email-input"
          />
        </Field>

        <Field label={t('family:invitations.modal.role')}>
          <p className="font-body text-body text-text-1">
            {t('family:invitations.modal.roleAdult')}
          </p>
        </Field>

        <div className="flex flex-col gap-1">
          <label htmlFor={messageId} className="font-body text-meta font-medium text-text-1">
            {t('family:invitations.modal.personalMessage')}
          </label>
          <textarea
            id={messageId}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('family:invitations.modal.personalMessagePlaceholder')}
            rows={4}
            maxLength={MAX_MESSAGE * 2}
            aria-describedby={messageCounterId}
            aria-invalid={messageOverLimit}
            disabled={submitting}
            className="rounded-md border border-stroke bg-canvas-0 px-3 py-2 font-body text-body text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-1 disabled:opacity-50"
            data-testid="invite-message-input"
          />
          <p
            id={messageCounterId}
            className={`font-body text-meta ${messageOverLimit ? 'text-danger' : 'text-text-3'}`}
            aria-live="polite"
            data-testid="invite-message-counter"
          >
            {t('family:invitations.modal.personalMessageMax', { count: messageLength })}
          </p>
        </div>

        {genericError ? (
          <p
            ref={genericErrorRef}
            role="alert"
            className="font-body text-body text-danger"
            data-testid="invite-generic-error"
          >
            {genericError}
          </p>
        ) : null}

        <div className="flex flex-row-reverse items-center justify-start gap-2 pt-2">
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={submitDisabled}
            data-testid="invite-submit"
          >
            {submitting
              ? t('family:invitations.modal.sending')
              : t('family:invitations.modal.send')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
            data-testid="invite-cancel"
          >
            {t('family:invitations.modal.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
