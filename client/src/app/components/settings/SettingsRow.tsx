// One configurable row inside a SettingsSection.
//
// Layout: label + optional description on the left, control on the
// right. When `disabled` is true the row dims to indicate "Coming
// soon" / "Krever Resend" features that are intentionally not
// available in this build, with an optional badge showing the sprint
// where the feature is planned.
//
// Disabled rows still rendrer the control so screen-readers read it,
// but pointer-events are cut and the inline-input/toggle is wrapped
// in a `aria-disabled`-marked container. Tab order skips disabled
// rows by setting tabIndex={-1} on the wrapper.

import { type ReactNode } from 'react';

export interface SettingsRowProps {
  /** Already-translated label text. */
  label: string;
  /** Optional already-translated helper text under the label. */
  description?: string;
  /** Control element rendered on the right (toggle / select / button). */
  control?: ReactNode;
  /** When true the row is dimmed and its control is interactive-blocked. */
  disabled?: boolean;
  /** Optional already-translated badge (e.g. "Sprint 7"). Renders next to the label when set. */
  badge?: string;
  /** Optional aria-label override for the row. */
  ariaLabel?: string;
}

export function SettingsRow({
  label,
  description,
  control,
  disabled = false,
  badge,
  ariaLabel,
}: SettingsRowProps): JSX.Element {
  return (
    <div
      className={['flex items-center gap-3 px-4 py-3', disabled ? 'opacity-60' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid="settings-row"
      data-disabled={disabled ? 'true' : 'false'}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-body text-body text-text-1">{label}</span>
          {badge && (
            <span
              className="inline-flex items-center rounded-pill border border-stroke bg-canvas-1 px-2 py-0.5 font-mono text-[10px] text-text-2"
              data-testid="settings-row-badge"
            >
              {badge}
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 font-body text-meta text-text-3">{description}</p>}
      </div>
      {control && (
        <div
          className={disabled ? 'pointer-events-none' : ''}
          {...(disabled ? { 'aria-disabled': 'true' } : {})}
          data-testid="settings-row-control"
        >
          {control}
        </div>
      )}
    </div>
  );
}
