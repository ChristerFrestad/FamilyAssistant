// Tests for the Badge display primitive.

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Badge } from './Badge';

test('renders the children inside a pill with the variant background', () => {
  render(
    <Badge variant="mint" data-testid="badge">
      Ny
    </Badge>
  );
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveTextContent('Ny');
  expect(badge).toHaveClass('bg-mint');
  expect(badge).toHaveClass('text-ink-contrast');
  expect(badge).toHaveClass('rounded-pill');
});

test('every variant maps to the matching bg-* utility', () => {
  const variants = ['mint', 'cyan', 'amber', 'coral', 'rose'] as const;
  for (const v of variants) {
    const { unmount } = render(
      <Badge variant={v} data-testid={`b-${v}`}>
        x
      </Badge>
    );
    expect(screen.getByTestId(`b-${v}`)).toHaveClass(`bg-${v}`);
    unmount();
  }
});

test('dot mode renders a plain colored circle without children', () => {
  render(
    <Badge variant="rose" dot data-testid="badge">
      ignored
    </Badge>
  );
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveClass('h-2');
  expect(badge).toHaveClass('w-2');
  expect(badge).toHaveClass('rounded-full');
  expect(badge).toHaveClass('bg-rose');
  // Dot mode is decorative and aria-hidden so screen readers do not
  // announce a meaningless presence indicator.
  expect(badge).toHaveAttribute('aria-hidden', 'true');
  // Children must NOT render in dot mode.
  expect(badge).not.toHaveTextContent('ignored');
});

test('caller-supplied className appends after the computed classes', () => {
  render(
    <Badge variant="cyan" className="ml-2" data-testid="badge">
      x
    </Badge>
  );
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveClass('bg-cyan');
  expect(badge).toHaveClass('ml-2');
});

test('forwardRef exposes the underlying span element', () => {
  const ref = createRef<HTMLSpanElement>();
  render(
    <Badge ref={ref} variant="amber">
      x
    </Badge>
  );
  expect(ref.current).toBeInstanceOf(HTMLSpanElement);
});
