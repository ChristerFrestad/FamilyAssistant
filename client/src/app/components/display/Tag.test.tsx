// Tests for the Tag display primitive.

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { Tag } from './Tag';

test('renders children with the default cyan variant', () => {
  render(<Tag data-testid="tag">Mat</Tag>);
  const tag = screen.getByTestId('tag');
  expect(tag).toHaveTextContent('Mat');
  expect(tag).toHaveClass('bg-cyan');
  expect(tag).toHaveClass('text-ink-contrast');
  expect(tag).toHaveClass('rounded-md');
});

test('every variant maps to the matching bg-* utility', () => {
  const variants = ['mint', 'cyan', 'amber', 'coral', 'rose'] as const;
  for (const v of variants) {
    const { unmount } = render(
      <Tag variant={v} data-testid={`t-${v}`}>
        x
      </Tag>
    );
    expect(screen.getByTestId(`t-${v}`)).toHaveClass(`bg-${v}`);
    unmount();
  }
});

test('removable={true} + onRemove renders the remove button', () => {
  render(
    <Tag removable onRemove={() => undefined}>
      Mat
    </Tag>
  );
  expect(screen.getByRole('button', { name: 'Fjern' })).toBeInTheDocument();
});

test('removable={true} WITHOUT onRemove renders no button (silent no-op)', () => {
  // Defensive rule: rendering a button with no handler would be a
  // dead control. Tags whose removable flag toggles via feature
  // flag should not produce a half-wired UI.
  render(<Tag removable>Mat</Tag>);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('clicking the remove button fires onRemove exactly once', async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  render(
    <Tag removable onRemove={onRemove}>
      Mat
    </Tag>
  );
  await user.click(screen.getByRole('button', { name: 'Fjern' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test('removeLabel prop overrides the default aria-label', () => {
  render(
    <Tag removable onRemove={() => undefined} removeLabel="Fjern allergi">
      Nøtter
    </Tag>
  );
  expect(screen.getByRole('button', { name: 'Fjern allergi' })).toBeInTheDocument();
});

test('the remove control is a real <button>, not a <span> with onClick', () => {
  render(
    <Tag removable onRemove={() => undefined}>
      Mat
    </Tag>
  );
  const btn = screen.getByRole('button', { name: 'Fjern' });
  expect(btn.tagName).toBe('BUTTON');
  // Defaults to type=button so it never accidentally submits a parent form.
  expect(btn).toHaveAttribute('type', 'button');
});

test('caller-supplied className appends after the computed classes', () => {
  render(
    <Tag variant="amber" className="m-1" data-testid="tag">
      x
    </Tag>
  );
  const tag = screen.getByTestId('tag');
  expect(tag).toHaveClass('bg-amber');
  expect(tag).toHaveClass('m-1');
});

test('forwardRef exposes the underlying span element', () => {
  const ref = createRef<HTMLSpanElement>();
  render(<Tag ref={ref}>x</Tag>);
  expect(ref.current).toBeInstanceOf(HTMLSpanElement);
});
