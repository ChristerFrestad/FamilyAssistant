// Container for a logical group of settings rows.
//
// Renders a Card with a heading and optional descriptive subtitle,
// followed by the children (typically a stack of SettingsRow). The
// component is presentation-only — it does not own any state or know
// what kind of rows it contains.
//
// Section heading uses font-display + text-card so it reads as the
// strongest typographic anchor inside the card, matching the
// hierarchy used by Family / Pantry summary cards.

import type { JSX } from 'react';
import { type ReactNode } from 'react';
import { Card } from '../layout/Card';

export interface SettingsSectionProps {
  /** Already-translated section title. */
  title: string;
  /** Optional already-translated description shown under the title. */
  description?: string;
  /** Stable id for aria-labelledby wiring. */
  id?: string;
  children: ReactNode;
}

export function SettingsSection({
  title,
  description,
  id,
  children,
}: SettingsSectionProps): JSX.Element {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <Card padding="none" shadow="low" data-testid="settings-section">
      <header className="border-b border-stroke px-4 py-3">
        <h2
          {...(headingId ? { id: headingId } : {})}
          className="font-display text-card text-text-1"
        >
          {title}
        </h2>
        {description && <p className="mt-1 font-body text-meta text-text-2">{description}</p>}
      </header>
      <div
        {...(headingId ? { 'aria-labelledby': headingId } : {})}
        className="divide-y divide-stroke"
      >
        {children}
      </div>
    </Card>
  );
}
