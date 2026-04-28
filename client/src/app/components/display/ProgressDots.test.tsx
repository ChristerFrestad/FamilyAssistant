// Tests for the ProgressDots display primitive.

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { ProgressDots } from './ProgressDots';

test('renders the requested number of dots', () => {
  render(<ProgressDots total={5} current={1} data-testid="dots" />);
  const wrapper = screen.getByTestId('dots');
  // Each dot is a direct child <span> of the wrapper.
  expect(wrapper.children).toHaveLength(5);
});

test('aria-label uses the Norwegian "Steg X av Y" pattern', () => {
  render(<ProgressDots total={5} current={3} />);
  // The wrapper carries role=status + aria-label, so getByRole picks it up.
  expect(screen.getByRole('status', { name: 'Steg 3 av 5' })).toBeInTheDocument();
});

test('the current step dot uses the bg-mint utility (no opacity reduction)', () => {
  render(<ProgressDots total={5} current={3} data-testid="dots" />);
  const dots = screen.getByTestId('dots').children;
  const currentDot = dots[2] as HTMLElement; // 0-indexed -> step 3
  expect(currentDot).toHaveClass('bg-mint');
  expect(currentDot).not.toHaveClass('opacity-60');
});

test('completed dots (before current) carry the opacity-60 modifier', () => {
  render(<ProgressDots total={5} current={3} data-testid="dots" />);
  const dots = screen.getByTestId('dots').children;
  const completedDot = dots[0] as HTMLElement; // step 1
  expect(completedDot).toHaveClass('bg-mint');
  expect(completedDot).toHaveClass('opacity-60');
});

test('pending dots (after current) use the stroke-strong background', () => {
  render(<ProgressDots total={5} current={3} data-testid="dots" />);
  const dots = screen.getByTestId('dots').children;
  const pendingDot = dots[3] as HTMLElement; // step 4
  expect(pendingDot).toHaveClass('bg-stroke-strong');
  expect(pendingDot).not.toHaveClass('bg-mint');
});

test('size=sm and size=lg apply matching dot dimension utilities', () => {
  const { rerender } = render(<ProgressDots total={3} current={1} size="sm" data-testid="dots" />);
  let firstDot = screen.getByTestId('dots').children[0] as HTMLElement;
  expect(firstDot).toHaveClass('w-2');
  expect(firstDot).toHaveClass('h-2');

  rerender(<ProgressDots total={3} current={1} size="lg" data-testid="dots" />);
  firstDot = screen.getByTestId('dots').children[0] as HTMLElement;
  expect(firstDot).toHaveClass('w-3');
  expect(firstDot).toHaveClass('h-3');
});

test('forwardRef exposes the wrapper div', () => {
  const ref = createRef<HTMLDivElement>();
  render(<ProgressDots ref={ref} total={3} current={1} />);
  expect(ref.current).toBeInstanceOf(HTMLDivElement);
});
