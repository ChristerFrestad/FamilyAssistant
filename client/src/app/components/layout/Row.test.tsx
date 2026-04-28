// Tests for the Row layout primitive. Mirrors Stack's structure
// plus the Row-specific justify and wrap props.

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Row } from './Row';

test('renders a flex-row div with default classes', () => {
  render(<Row data-testid="row">a</Row>);
  const row = screen.getByTestId('row');
  expect(row.tagName).toBe('DIV');
  expect(row).toHaveClass('flex');
  expect(row).toHaveClass('flex-row');
  // Defaults: gap=md, align=stretch, justify=start, wrap=false.
  expect(row).toHaveClass('gap-4');
  expect(row).toHaveClass('items-stretch');
  expect(row).toHaveClass('justify-start');
  expect(row).not.toHaveClass('flex-wrap');
});

test('renders multiple children', () => {
  render(
    <Row data-testid="row">
      <span>a</span>
      <span>b</span>
    </Row>
  );
  expect(screen.getByTestId('row').children).toHaveLength(2);
});

test('gap aliases map to the matching gap-* utilities', () => {
  const { rerender } = render(<Row gap="xs" data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('gap-1');
  rerender(<Row gap="xl" data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('gap-10');
});

test('align values map to the matching items-* utilities', () => {
  const { rerender } = render(<Row align="center" data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('items-center');
  rerender(<Row align="end" data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('items-end');
});

test('justify values map to the matching justify-* utilities', () => {
  const { rerender } = render(<Row justify="center" data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('justify-center');
  rerender(<Row justify="end" data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('justify-end');
  rerender(<Row justify="between" data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('justify-between');
  rerender(<Row justify="around" data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('justify-around');
});

test('wrap=true adds flex-wrap; wrap=false omits it', () => {
  const { rerender } = render(<Row wrap data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveClass('flex-wrap');
  rerender(<Row wrap={false} data-testid="row" />);
  expect(screen.getByTestId('row')).not.toHaveClass('flex-wrap');
});

test('caller-supplied className appends after the computed classes', () => {
  render(<Row className="w-full" data-testid="row" />);
  const row = screen.getByTestId('row');
  expect(row).toHaveClass('flex-row');
  expect(row).toHaveClass('w-full');
});

test('forwardRef exposes the underlying div element', () => {
  const ref = createRef<HTMLDivElement>();
  render(<Row ref={ref}>x</Row>);
  expect(ref.current).toBeInstanceOf(HTMLDivElement);
});

test('rest props spread to the underlying div', () => {
  render(<Row role="toolbar" aria-label="Actions" data-testid="row" />);
  const row = screen.getByRole('toolbar', { name: 'Actions' });
  expect(row).toBe(screen.getByTestId('row'));
});
