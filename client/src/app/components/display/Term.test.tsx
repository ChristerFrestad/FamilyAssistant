// Tests for the Term display primitive.

import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Term } from './Term';

test('inline variant renders as a <code> element with the inline classes', () => {
  render(<Term data-testid="term">npm install</Term>);
  const term = screen.getByTestId('term');
  expect(term.tagName).toBe('CODE');
  expect(term).toHaveTextContent('npm install');
  expect(term).toHaveClass('font-mono');
  expect(term).toHaveClass('bg-canvas-2');
  expect(term).toHaveClass('rounded-sm');
  expect(term).toHaveClass('px-1.5');
});

test('block variant renders as a <pre> element with overflow handling', () => {
  render(
    <Term variant="block" data-testid="term">
      const x = 1;{'\n'}const y = 2;
    </Term>
  );
  const term = screen.getByTestId('term');
  expect(term.tagName).toBe('PRE');
  expect(term).toHaveClass('font-mono');
  expect(term).toHaveClass('bg-canvas-2');
  expect(term).toHaveClass('rounded-md');
  expect(term).toHaveClass('overflow-x-auto');
  expect(term).toHaveClass('whitespace-pre');
});

test('size=sm and size=lg apply matching text-size utilities (inline)', () => {
  const { rerender } = render(
    <Term size="sm" data-testid="term">
      x
    </Term>
  );
  expect(screen.getByTestId('term')).toHaveClass('text-label');
  rerender(
    <Term size="lg" data-testid="term">
      x
    </Term>
  );
  expect(screen.getByTestId('term')).toHaveClass('text-body');
});

test('size scales the block variant the same way as inline', () => {
  render(
    <Term variant="block" size="lg" data-testid="term">
      multiline
    </Term>
  );
  expect(screen.getByTestId('term')).toHaveClass('text-body');
});

test('caller-supplied className appends after computed classes', () => {
  render(
    <Term className="select-all" data-testid="term">
      SESSION_SECRET
    </Term>
  );
  const term = screen.getByTestId('term');
  expect(term).toHaveClass('font-mono');
  expect(term).toHaveClass('select-all');
});

test('renders arbitrary ReactNode children, not just strings', () => {
  render(
    <Term data-testid="term">
      <span data-testid="inner">npm</span>
      &nbsp;install
    </Term>
  );
  expect(screen.getByTestId('inner')).toBeInTheDocument();
  expect(screen.getByTestId('term')).toHaveTextContent('npm');
});
