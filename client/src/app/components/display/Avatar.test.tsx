// Tests for the Avatar display primitive. Covers both happy path
// (image renders) and the failure path (onError swap to initials),
// plus the locale-aware initial-generation rules.

import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Avatar, getInitials } from './Avatar';

test('renders an <img> when src is provided and the load succeeds', () => {
  render(<Avatar src="/family/christer.jpg" alt="Christer Frestad" />);
  // role="img" + aria-label is on the wrapper; the inner <img> has
  // an empty alt because the wrapper carries the accessible name.
  const wrapper = screen.getByRole('img', { name: 'Christer Frestad' });
  const img = wrapper.querySelector('img');
  expect(img).toBeInTheDocument();
  expect(img).toHaveAttribute('src', '/family/christer.jpg');
});

test('falls back to initials when no src is provided', () => {
  render(<Avatar alt="Christer Frestad" />);
  const wrapper = screen.getByRole('img', { name: 'Christer Frestad' });
  expect(wrapper.querySelector('img')).not.toBeInTheDocument();
  // The initials span is aria-hidden; the wrapper carries the name
  // for assistive tech, so we read the visible text directly.
  expect(wrapper).toHaveTextContent('CF');
});

test('falls back to initials when the image load fails (onError)', () => {
  render(<Avatar src="/missing.jpg" alt="Marie Olsen Berg" />);
  const wrapper = screen.getByRole('img', { name: 'Marie Olsen Berg' });
  const img = wrapper.querySelector('img');
  expect(img).toBeInTheDocument();
  // Simulate a load failure — fireEvent is the right tool here
  // because user-event has no "trigger image error" verb.
  fireEvent.error(img as HTMLImageElement);
  expect(wrapper.querySelector('img')).not.toBeInTheDocument();
  expect(wrapper).toHaveTextContent('MB');
});

test('explicit fallback prop overrides initial generation', () => {
  render(<Avatar alt="Christer Frestad" fallback="VIP" />);
  const wrapper = screen.getByRole('img', { name: 'Christer Frestad' });
  expect(wrapper).toHaveTextContent('VIP');
  expect(wrapper).not.toHaveTextContent('CF');
});

test('size and shape props apply the matching utilities', () => {
  const { rerender } = render(<Avatar alt="A B" size="sm" />);
  expect(screen.getByRole('img', { name: 'A B' })).toHaveClass('h-8');
  rerender(<Avatar alt="A B" size="xl" />);
  expect(screen.getByRole('img', { name: 'A B' })).toHaveClass('h-24');

  rerender(<Avatar alt="A B" shape="square" />);
  expect(screen.getByRole('img', { name: 'A B' })).toHaveClass('rounded-lg');
  rerender(<Avatar alt="A B" shape="round" />);
  expect(screen.getByRole('img', { name: 'A B' })).toHaveClass('rounded-full');
});

test('forwardRef exposes the wrapper div', () => {
  const ref = createRef<HTMLDivElement>();
  render(<Avatar ref={ref} alt="X" />);
  expect(ref.current).toBeInstanceOf(HTMLDivElement);
});

// ---------------------------------------------------------------------
// getInitials helper — direct unit tests for the initial-generation
// edge cases. Co-located with the component because the helper is
// intentionally not part of the component's public API; testing it
// here proves the rules without leaking internals.
// ---------------------------------------------------------------------

test('getInitials: two-word name returns first letter of each', () => {
  expect(getInitials('Christer Frestad')).toBe('CF');
});

test('getInitials: three-word name picks first and LAST, not middle', () => {
  expect(getInitials('Marie Olsen Berg')).toBe('MB');
});

test('getInitials: single-word name returns the first letter only', () => {
  expect(getInitials('Æsop')).toBe('Æ');
});

test('getInitials: Norwegian letters æ ø å uppercase via locale', () => {
  expect(getInitials('åse øystein')).toBe('ÅØ');
});

test('getInitials: empty / whitespace-only input returns "?"', () => {
  expect(getInitials('')).toBe('?');
  expect(getInitials('   ')).toBe('?');
});

test('getInitials: collapses multiple spaces between words', () => {
  expect(getInitials('Christer    Frestad')).toBe('CF');
});
