// Tests for EmptyState.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, describe, vi } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState — no-list variant', () => {
  test('renders title + body + CTA when onGenerate is provided', () => {
    render(<EmptyState variant="no-list" onGenerate={() => {}} />);
    expect(screen.getByText('Ingen handleliste denne uka')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generer fra ukens middager' })).toBeInTheDocument();
  });

  test('CTA fires onGenerate', async () => {
    const onGenerate = vi.fn();
    render(<EmptyState variant="no-list" onGenerate={onGenerate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generer fra ukens middager' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  test('CTA shows loading spinner when generating=true', () => {
    render(<EmptyState variant="no-list" onGenerate={() => {}} generating={true} />);
    // Loading=true adds an aria-label="Loading" spinner to the button, so the
    // accessible name shifts. Match by data-testid instead.
    const btn = screen.getByTestId('shopping-generate-cta');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  test('omits CTA when onGenerate is not provided', () => {
    render(<EmptyState variant="no-list" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EmptyState — no-items variant', () => {
  test('renders the empty-items copy', () => {
    render(<EmptyState variant="no-items" />);
    expect(screen.getByText('Handlelisten er tom')).toBeInTheDocument();
    expect(
      screen.getByText('Legg til en vare i feltet nederst for å komme i gang.')
    ).toBeInTheDocument();
  });

  test('does not render the generate CTA on no-items', () => {
    render(<EmptyState variant="no-items" onGenerate={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Generer fra ukens middager' })).toBeNull();
  });
});
