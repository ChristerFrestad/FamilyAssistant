// Tests for the Stack layout primitive.

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Stack } from './Stack';

test('renders a flex-column div with default classes', () => {
  render(<Stack data-testid="stack">a</Stack>);
  const stack = screen.getByTestId('stack');
  expect(stack.tagName).toBe('DIV');
  expect(stack).toHaveClass('flex');
  expect(stack).toHaveClass('flex-col');
  // Defaults: gap=md -> gap-4, align=stretch -> items-stretch.
  expect(stack).toHaveClass('gap-4');
  expect(stack).toHaveClass('items-stretch');
});

test('renders multiple children', () => {
  render(
    <Stack data-testid="stack">
      <span>one</span>
      <span>two</span>
      <span>three</span>
    </Stack>
  );
  expect(screen.getByTestId('stack').children).toHaveLength(3);
});

test('gap aliases map to the matching gap-* utilities', () => {
  const { rerender } = render(<Stack gap="xs" data-testid="stack" />);
  expect(screen.getByTestId('stack')).toHaveClass('gap-1');
  rerender(<Stack gap="sm" data-testid="stack" />);
  expect(screen.getByTestId('stack')).toHaveClass('gap-2');
  rerender(<Stack gap="lg" data-testid="stack" />);
  expect(screen.getByTestId('stack')).toHaveClass('gap-6');
  rerender(<Stack gap="xl" data-testid="stack" />);
  expect(screen.getByTestId('stack')).toHaveClass('gap-10');
});

test('align values map to the matching items-* utilities', () => {
  const { rerender } = render(<Stack align="start" data-testid="stack" />);
  expect(screen.getByTestId('stack')).toHaveClass('items-start');
  rerender(<Stack align="center" data-testid="stack" />);
  expect(screen.getByTestId('stack')).toHaveClass('items-center');
  rerender(<Stack align="end" data-testid="stack" />);
  expect(screen.getByTestId('stack')).toHaveClass('items-end');
});

test('caller-supplied className appends after the computed classes', () => {
  render(<Stack className="min-h-screen" data-testid="stack" />);
  const stack = screen.getByTestId('stack');
  expect(stack).toHaveClass('flex-col');
  expect(stack).toHaveClass('min-h-screen');
});

test('forwardRef exposes the underlying div element', () => {
  const ref = createRef<HTMLDivElement>();
  render(<Stack ref={ref}>x</Stack>);
  expect(ref.current).toBeInstanceOf(HTMLDivElement);
});

test('rest props spread to the underlying div', () => {
  render(<Stack id="form-stack" role="group" data-testid="stack" />);
  const stack = screen.getByTestId('stack');
  expect(stack).toHaveAttribute('id', 'form-stack');
  expect(stack).toHaveAttribute('role', 'group');
});
