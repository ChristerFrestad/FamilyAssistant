// Shared page heading for primary AppShell screens. Replaces the
// copy-pasted eyebrow + h1 + subtitle + trailing-action markup on
// Meals, Chores, Calendar, Recipes, Settings, Shopping, and Family.
//
// titleHidden renders an sr-only h1 so Family can keep a visible
// card title without losing the screen heading for aria-labelledby.
// Dashboard WelcomeHeader is intentionally not migrated here.

import type { JSX, ReactNode } from 'react';
import type { HTMLAttributes } from 'react';

export interface ScreenHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Small uppercase label above the title (week / family kicker). */
  eyebrow?: string;
  /** Visible h1 unless titleHidden. */
  title: string;
  /** Render the h1 as sr-only (Family / Dashboard cases). */
  titleHidden?: boolean;
  /** id for the h1. Defaults to screen-heading. */
  titleId?: string;
  /** Body-size line under the title. */
  subtitle?: ReactNode;
  /** Trailing slot (desktop add button, library link). */
  actions?: ReactNode;
  /** Extra meta under the subtitle (week year, date range, stats). */
  children?: ReactNode;
}

const WRAP_COL = 'flex flex-col gap-1';
const WRAP_ROW = 'flex flex-row items-start justify-between gap-3';
const EYEBROW = 'font-body text-meta uppercase tracking-wider text-text-3';
const TITLE = 'font-display text-display-md text-text-1';
const SUBTITLE = 'font-body text-body text-text-2';

export function ScreenHeader({
  eyebrow,
  title,
  titleHidden = false,
  titleId = 'screen-heading',
  subtitle,
  actions,
  children,
  className,
  ...rest
}: ScreenHeaderProps): JSX.Element {
  const heading = (
    <h1 id={titleId} className={titleHidden ? 'sr-only' : TITLE}>
      {title}
    </h1>
  );

  const text = (
    <>
      {eyebrow ? <span className={EYEBROW}>{eyebrow}</span> : null}
      {heading}
      {subtitle != null && subtitle !== '' ? <p className={SUBTITLE}>{subtitle}</p> : null}
      {children}
    </>
  );

  return (
    <header className={[actions ? WRAP_ROW : WRAP_COL, className].filter(Boolean).join(' ')} {...rest}>
      {actions ? <div className={`min-w-0 ${WRAP_COL}`}>{text}</div> : text}
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
