// Tests for the Card layout primitive. Co-located with the
// implementation. Same structural choices as Button/Input/Field
// tests: explicit imports from 'vitest', screen.* queries, no
// fireEvent.

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Card } from './Card';

test('renders the children inside a div with default classes', () => {
  render(<Card data-testid="card">Inside</Card>);
  const card = screen.getByTestId('card');
  expect(card.tagName).toBe('DIV');
  expect(card).toHaveTextContent('Inside');
  // Defaults: variant=default (bg-surface), padding=md (p-4),
  // border=true (border + border-stroke), shadow=none.
  expect(card).toHaveClass('bg-surface');
  expect(card).toHaveClass('p-4');
  expect(card).toHaveClass('border');
  expect(card).toHaveClass('border-stroke');
  expect(card).toHaveClass('rounded-lg');
});

test('variant=strong applies the surface-strong background', () => {
  render(<Card variant="strong" data-testid="card" />);
  expect(screen.getByTestId('card')).toHaveClass('bg-surface-strong');
});

test('variant=glass applies surface plus backdrop blur', () => {
  render(<Card variant="glass" data-testid="card" />);
  const card = screen.getByTestId('card');
  expect(card).toHaveClass('bg-surface');
  expect(card).toHaveClass('backdrop-blur-md');
});

test('padding=none emits no padding class while keeping the rest', () => {
  render(<Card padding="none" data-testid="card" />);
  const card = screen.getByTestId('card');
  expect(card).not.toHaveClass('p-3');
  expect(card).not.toHaveClass('p-4');
  expect(card).not.toHaveClass('p-6');
  // Sanity: variant + border still applied.
  expect(card).toHaveClass('bg-surface');
  expect(card).toHaveClass('border');
});

test('padding sm and lg apply their respective tokens', () => {
  const { rerender } = render(<Card padding="sm" data-testid="card" />);
  expect(screen.getByTestId('card')).toHaveClass('p-3');
  rerender(<Card padding="lg" data-testid="card" />);
  expect(screen.getByTestId('card')).toHaveClass('p-6');
});

test('border=false omits the border classes', () => {
  render(<Card border={false} data-testid="card" />);
  const card = screen.getByTestId('card');
  expect(card).not.toHaveClass('border');
  expect(card).not.toHaveClass('border-stroke');
});

test('shadow values map to the corresponding token utilities', () => {
  const { rerender } = render(<Card shadow="low" data-testid="card" />);
  expect(screen.getByTestId('card')).toHaveClass('shadow-low');
  rerender(<Card shadow="mid" data-testid="card" />);
  expect(screen.getByTestId('card')).toHaveClass('shadow-mid');
  rerender(<Card shadow="high" data-testid="card" />);
  expect(screen.getByTestId('card')).toHaveClass('shadow-high');
});

test('caller-supplied className appends after the computed classes', () => {
  render(<Card className="w-72" data-testid="card" />);
  const card = screen.getByTestId('card');
  // Sanity: variant default still applied, plus the override.
  expect(card).toHaveClass('bg-surface');
  expect(card).toHaveClass('w-72');
});

test('forwardRef exposes the underlying div element', () => {
  const ref = createRef<HTMLDivElement>();
  render(<Card ref={ref}>Body</Card>);
  expect(ref.current).toBeInstanceOf(HTMLDivElement);
  expect(ref.current?.textContent).toBe('Body');
});

test('rest props (id, role, data-*) spread to the underlying div', () => {
  render(
    <Card id="meal-card" role="region" aria-label="Today's dinner" data-section="meals">
      Hi
    </Card>
  );
  const card = screen.getByRole('region', { name: "Today's dinner" });
  expect(card).toHaveAttribute('id', 'meal-card');
  expect(card).toHaveAttribute('data-section', 'meals');
});
