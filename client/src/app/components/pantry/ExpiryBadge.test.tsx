// Tests for ExpiryBadge — covers the full date-arithmetic surface
// because get-this-wrong-and-the-pilot-shows-misleading-info is the
// failure mode we care about most.

import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n/config';
import { ExpiryBadge } from './ExpiryBadge';

function renderBadge(expiresEst: string | null, now = new Date('2026-04-30T12:00:00Z')) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ExpiryBadge expiresEst={expiresEst} now={now} />
    </I18nextProvider>
  );
}

describe('ExpiryBadge — visibility', () => {
  test('renders nothing when expiresEst is null', () => {
    const { container } = renderBadge(null);
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing for items expiring more than 7 days out', () => {
    // Now is 2026-04-30; +30 days is 2026-05-30
    const { container } = renderBadge('2026-05-30');
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing for unparseable date', () => {
    const { container } = renderBadge('not-a-date');
    expect(container.firstChild).toBeNull();
  });
});

describe('ExpiryBadge — content', () => {
  test('shows "expired" when date is in the past', () => {
    // Now is 2026-04-30; -1 day is 2026-04-29
    renderBadge('2026-04-29');
    expect(screen.getByTestId('expiry-badge')).toBeInTheDocument();
    expect(screen.getByText(/utgått/i)).toBeInTheDocument();
  });

  test('shows "expires today" for today', () => {
    renderBadge('2026-04-30');
    expect(screen.getByText(/i dag/i)).toBeInTheDocument();
  });

  test('shows "expires tomorrow" for one-day-out', () => {
    renderBadge('2026-05-01');
    expect(screen.getByText(/i morgen/i)).toBeInTheDocument();
  });

  test('shows "expires in N days" for 2-7 days out', () => {
    renderBadge('2026-05-05'); // +5 days
    expect(screen.getByText(/5 dager/i)).toBeInTheDocument();
  });

  test('shows "expires in N days" at the 7-day boundary', () => {
    renderBadge('2026-05-07'); // +7 days exact
    expect(screen.getByText(/7 dager/i)).toBeInTheDocument();
  });
});

describe('ExpiryBadge — tone classes', () => {
  test('uses coral tone for expired', () => {
    renderBadge('2026-04-29');
    const badge = screen.getByTestId('expiry-badge');
    expect(badge.className).toContain('text-coral');
  });

  test('uses coral tone for "today"', () => {
    renderBadge('2026-04-30');
    const badge = screen.getByTestId('expiry-badge');
    expect(badge.className).toContain('text-coral');
  });

  test('uses coral tone for "tomorrow"', () => {
    renderBadge('2026-05-01');
    const badge = screen.getByTestId('expiry-badge');
    expect(badge.className).toContain('text-coral');
  });

  test('uses coral tone for 2 days out (under 3)', () => {
    renderBadge('2026-05-02');
    const badge = screen.getByTestId('expiry-badge');
    expect(badge.className).toContain('text-coral');
  });

  test('uses amber tone for 3-7 days out', () => {
    renderBadge('2026-05-04'); // +4 days
    const badge = screen.getByTestId('expiry-badge');
    expect(badge.className).toContain('text-amber');
  });
});
