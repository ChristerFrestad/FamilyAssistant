// Tests for the PageShell layout primitive.

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { PageShell } from './PageShell';

test('renders children inside a centered, padded div with default classes', () => {
  render(<PageShell data-testid="shell">Hello</PageShell>);
  const shell = screen.getByTestId('shell');
  expect(shell.tagName).toBe('DIV');
  expect(shell).toHaveTextContent('Hello');
  // Defaults: maxWidth=md (max-w-2xl), compact=false (py-8), always
  // px-4 + mx-auto + w-full.
  expect(shell).toHaveClass('mx-auto');
  expect(shell).toHaveClass('w-full');
  expect(shell).toHaveClass('px-4');
  expect(shell).toHaveClass('py-8');
  expect(shell).toHaveClass('max-w-2xl');
});

test('maxWidth=sm and lg apply the matching max-width utilities', () => {
  const { rerender } = render(<PageShell maxWidth="sm" data-testid="shell" />);
  expect(screen.getByTestId('shell')).toHaveClass('max-w-md');
  rerender(<PageShell maxWidth="lg" data-testid="shell" />);
  expect(screen.getByTestId('shell')).toHaveClass('max-w-4xl');
});

test('compact swaps the vertical padding from py-8 to py-4', () => {
  render(<PageShell compact data-testid="shell" />);
  const shell = screen.getByTestId('shell');
  expect(shell).toHaveClass('py-4');
  expect(shell).not.toHaveClass('py-8');
});

test('caller-supplied className appends after computed classes', () => {
  render(<PageShell className="bg-canvas-1" data-testid="shell" />);
  const shell = screen.getByTestId('shell');
  expect(shell).toHaveClass('mx-auto');
  expect(shell).toHaveClass('bg-canvas-1');
});

test('forwardRef exposes the underlying div element', () => {
  const ref = createRef<HTMLDivElement>();
  render(<PageShell ref={ref}>x</PageShell>);
  expect(ref.current).toBeInstanceOf(HTMLDivElement);
});
