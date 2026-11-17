import { render, screen } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach } from 'vitest';
import { CalendarFeedCard } from './CalendarFeedCard';

describe('CalendarFeedCard live region', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ active: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
  });

  test('the live region is mounted before a link exists', async () => {
    render(<CalendarFeedCard isOwner />);
    const live = await screen.findByTestId('calendar-feed-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByTestId('calendar-feed-link')).not.toBeInTheDocument();
    expect(live).toHaveTextContent('Ingen aktiv lenke.');
  });
});