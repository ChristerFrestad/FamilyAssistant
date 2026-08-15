// Tests for the shared ScreenHeader layout primitive.

import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { ScreenHeader } from './ScreenHeader';

test('renders a visible h1 with the default screen-heading id', () => {
  render(<ScreenHeader title="Måltider" />);
  const heading = screen.getByRole('heading', { name: 'Måltider', level: 1 });
  expect(heading).toHaveAttribute('id', 'screen-heading');
  expect(heading).toHaveClass('font-display', 'text-display-md', 'text-text-1');
  expect(heading).not.toHaveClass('sr-only');
});

test('titleHidden makes the h1 sr-only and keeps the accessible name', () => {
  render(<ScreenHeader title="Familie" titleHidden />);
  const heading = screen.getByRole('heading', { name: 'Familie', level: 1 });
  expect(heading).toHaveClass('sr-only');
  expect(heading).not.toHaveClass('font-display');
});

test('titleId overrides the default heading id', () => {
  render(<ScreenHeader title="Gjøremål" titleId="chores-heading" />);
  expect(screen.getByRole('heading', { name: 'Gjøremål', level: 1 })).toHaveAttribute(
    'id',
    'chores-heading'
  );
});

test('renders eyebrow, subtitle, and children under the title', () => {
  render(
    <ScreenHeader eyebrow="Denne uken" title="Måltider" subtitle="Planlegg ukens middager">
      <p data-testid="week-meta">Uke 2026-W18</p>
    </ScreenHeader>
  );
  expect(screen.getByText('Denne uken')).toHaveClass(
    'font-body',
    'text-meta',
    'uppercase',
    'tracking-wider',
    'text-text-3'
  );
  expect(screen.getByText('Planlegg ukens middager')).toHaveClass(
    'font-body',
    'text-body',
    'text-text-2'
  );
  expect(screen.getByTestId('week-meta')).toHaveTextContent('Uke 2026-W18');
});

test('without actions the header is a column stack', () => {
  render(<ScreenHeader title="Kalender" data-testid="header" />);
  expect(screen.getByTestId('header')).toHaveClass('flex', 'flex-col', 'gap-1');
  expect(screen.getByTestId('header')).not.toHaveClass('flex-row');
});

test('with actions the header is a row and the action stays available', () => {
  render(
    <ScreenHeader
      title="Gjøremål"
      data-testid="header"
      actions={<button type="button">Legg til</button>}
    />
  );
  const header = screen.getByTestId('header');
  expect(header).toHaveClass('flex', 'flex-row', 'items-start', 'justify-between', 'gap-3');
  expect(screen.getByRole('button', { name: 'Legg til' })).toBeInTheDocument();
});
