// Tests for the Input component. Mirrors the structure of
// Button.test.tsx — explicit imports from 'vitest' (globals: false),
// userEvent for interaction, jest-dom matchers for assertions.

import type { JSX } from 'react';
import { createRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { Input } from './Input';

test('renders an input element with default props', () => {
  render(<Input data-testid="x" />);
  const input = screen.getByTestId('x');
  expect(input).toBeInstanceOf(HTMLInputElement);
  // Default size=md applies text-body
  expect(input).toHaveClass('text-body');
  // Default state is non-invalid -> stroke border, not rose
  expect(input).toHaveClass('border-stroke');
  expect(input).not.toHaveClass('border-rose');
});

test('forwards the type prop to the underlying input', () => {
  render(<Input type="email" data-testid="x" />);
  expect(screen.getByTestId('x')).toHaveAttribute('type', 'email');
});

test('forwards arbitrary input types (number / tel / url / password)', () => {
  // One assertion per type, kept compact since the only mechanism
  // under test is the prop spread.
  for (const t of ['number', 'tel', 'url', 'password'] as const) {
    const { unmount } = render(<Input type={t} data-testid={`x-${t}`} />);
    expect(screen.getByTestId(`x-${t}`)).toHaveAttribute('type', t);
    unmount();
  }
});

test('disabled blocks user input and reflects in the DOM', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Input disabled onChange={onChange} data-testid="x" />);
  const input = screen.getByTestId('x');
  expect(input).toBeDisabled();
  await user.type(input, 'hello');
  expect(onChange).not.toHaveBeenCalled();
});

test('onChange fires on user input', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Input onChange={onChange} data-testid="x" />);
  await user.type(screen.getByTestId('x'), 'a');
  // userEvent.type fires one change per keystroke; one char -> one call.
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('forwardRef exposes the underlying input element', () => {
  const ref = createRef<HTMLInputElement>();
  render(<Input ref={ref} />);
  expect(ref.current).toBeInstanceOf(HTMLInputElement);
});

test('aria-invalid={true} applies the rose error border', () => {
  render(<Input aria-invalid data-testid="x" />);
  const input = screen.getByTestId('x');
  expect(input).toHaveClass('border-rose');
  expect(input).not.toHaveClass('border-stroke');
  expect(input).toHaveAttribute('aria-invalid', 'true');
});

test('aria-invalid="grammar" also applies the rose error border', () => {
  // Per ARIA spec, "grammar" and "spelling" describe specific kinds
  // of invalidity but should render with the same error visual.
  render(<Input aria-invalid="grammar" data-testid="x" />);
  expect(screen.getByTestId('x')).toHaveClass('border-rose');
});

test('aria-invalid="false" keeps the default stroke border', () => {
  // The literal string "false" must not trigger the error state, even
  // though it is truthy as a JS string.
  render(<Input aria-invalid="false" data-testid="x" />);
  const input = screen.getByTestId('x');
  expect(input).toHaveClass('border-stroke');
  expect(input).not.toHaveClass('border-rose');
});

test('size=sm applies sm padding and meta text size', () => {
  render(<Input size="sm" data-testid="x" />);
  const input = screen.getByTestId('x');
  expect(input).toHaveClass('px-3');
  expect(input).toHaveClass('py-1.5');
  expect(input).toHaveClass('text-meta');
});

test('size=lg applies lg padding', () => {
  render(<Input size="lg" data-testid="x" />);
  const input = screen.getByTestId('x');
  expect(input).toHaveClass('px-4');
  expect(input).toHaveClass('py-2.5');
});

test('caller-supplied className appends after base/size/border classes', () => {
  render(<Input className="w-64" data-testid="x" />);
  const input = screen.getByTestId('x');
  // Sanity: the base + size + border classes still apply, plus the
  // caller override.
  expect(input).toHaveClass('border-stroke');
  expect(input).toHaveClass('text-body');
  expect(input).toHaveClass('w-64');
});

test('value and onChange wire as a controlled input', async () => {
  // Demonstrates that a controlled-input pattern works end-to-end
  // through the component (no swallowed events, no double rendering).
  function Controlled(): JSX.Element {
    const [v, setV] = useState('');
    return <Input data-testid="x" value={v} onChange={(e) => setV(e.target.value)} />;
  }
  const user = userEvent.setup();
  render(<Controlled />);
  await user.type(screen.getByTestId('x'), 'abc');
  expect(screen.getByTestId('x')).toHaveValue('abc');
});
