// Add-member modal — name-only roster row (no email / invitation).
//
// Fields: name (required), category adult|teen|child (required),
// optional portionFactor defaulting to the category's role default
// via getPortionFactorDefault. On success calls onSuccess with the
// created ProfileMember and closes; parent refreshes the roster.
//
// Mirrors InviteMemberModal patterns (Modal, Field, Input, Button,
// a11y, i18n) and UserProfile's category radiogroup / portion slider.

import type { JSX } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../overlay/Modal';
import { Button } from '../base/Button';
import { Input } from '../form/Input';
import { Field } from '../form/Field';
import {
  PortionFactorSlider,
  getPortionFactorDefault,
  type PortionRole,
} from '../form/PortionFactorSlider';
import {
  createMember,
  FamilyApiError,
  type MemberCategory,
  type ProfileMember,
} from '../../family/familyApi';

const CATEGORIES: MemberCategory[] = ['adult', 'teen', 'child'];

export interface AddMemberModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (member: ProfileMember) => void;
}

export function AddMemberModal({ open, onClose, onSuccess }: AddMemberModalProps): JSX.Element {
  const { t } = useTranslation('family');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [category, setCategory] = useState<MemberCategory>('adult');
  const [portionFactor, setPortionFactor] = useState(() => getPortionFactorDefault('adult'));
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);
  const categoryGroupId = useId();
  const genericErrorRef = useRef<HTMLParagraphElement | null>(null);

  // Reset form whenever the modal closes so re-opening starts clean.
  useEffect(() => {
    if (!open) {
      setName('');
      setNameTouched(false);
      setCategory('adult');
      setPortionFactor(getPortionFactorDefault('adult'));
      setSubmitting(false);
      setNameError(null);
      setGenericError(null);
    }
  }, [open]);

  const trimmedName = name.trim();
  const nameIsBlank = trimmedName.length === 0;
  const showLocalNameError = nameTouched && nameIsBlank;
  const inlineNameError =
    nameError ?? (showLocalNameError ? t('family:addMemberModal.validation.nameRequired') : null);
  const submitDisabled = submitting || nameIsBlank;

  function onCategoryChange(next: MemberCategory): void {
    setCategory(next);
    setPortionFactor((prev) => {
      const wasDefault = prev === getPortionFactorDefault(category as PortionRole);
      return wasDefault ? getPortionFactorDefault(next as PortionRole) : prev;
    });
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setNameTouched(true);
    if (submitDisabled) return;
    setSubmitting(true);
    setNameError(null);
    setGenericError(null);
    try {
      const r = await createMember({
        name: trimmedName,
        category,
        portionFactor,
      });
      onSuccess(r.member);
      onClose();
    } catch (err) {
      if (err instanceof FamilyApiError && err.status === 400) {
        setNameError(t('family:addMemberModal.validation.nameRequired'));
      } else {
        setGenericError(t('family:addMemberModal.validation.generic'));
      }
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={t('family:addMemberModal.title')}
      size="md"
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label={t('family:fields.name')}
          required
          {...(inlineNameError ? { error: inlineNameError } : {})}
        >
          <Input
            type="text"
            autoComplete="name"
            maxLength={100}
            placeholder={t('family:addMemberModal.namePlaceholder')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onBlur={() => setNameTouched(true)}
            disabled={submitting}
            data-testid="add-member-name-input"
          />
        </Field>

        <fieldset
          className="flex flex-col gap-2"
          aria-labelledby={categoryGroupId}
          data-testid="add-member-category-fieldset"
        >
          <legend id={categoryGroupId} className="font-body text-meta font-medium text-text-1">
            {t('family:fields.category')}
            <span className="text-rose-deep ml-0.5" aria-hidden="true">
              *
            </span>
          </legend>
          <div className="flex gap-2" role="radiogroup" aria-labelledby={categoryGroupId}>
            {CATEGORIES.map((c) => {
              const active = c === category;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onCategoryChange(c)}
                  disabled={submitting}
                  data-testid={`add-member-category-${c}`}
                  className={[
                    'flex-1 rounded-md px-3 py-2 font-body text-body',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    active
                      ? 'bg-ink text-ink-contrast'
                      : 'bg-surface text-text-1 hover:bg-surface-strong',
                  ].join(' ')}
                >
                  {t(`family:category.${c}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <Field
          label={t('family:fields.portionFactor')}
          hint={t('family:addMemberModal.portionHint')}
        >
          <PortionFactorSlider
            value={portionFactor}
            onChange={setPortionFactor}
            disabled={submitting}
            data-testid="add-member-portion-slider"
          />
        </Field>

        {genericError ? (
          <p
            ref={genericErrorRef}
            role="alert"
            className="font-body text-body text-danger"
            data-testid="add-member-generic-error"
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
            data-testid="add-member-submit"
          >
            {submitting ? t('family:addMemberModal.saving') : t('family:addMemberModal.submit')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
            data-testid="add-member-cancel"
          >
            {t('family:addMemberModal.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
