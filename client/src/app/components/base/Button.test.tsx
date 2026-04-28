// Tests for the Button component. Co-located so the test sits next
// to the implementation it covers. Globals are off in vitest.config,
// so test/expect/vi are imported explicitly. jest-dom matchers are
// loaded once via the test-setup file referenced from vitest.config.

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { Button } from './Button';

test('renders the button element with default props', () => {
  render(<Button>Click me</Button>);
  const btn = screen.getByRole('button', { name: 'Click me' });
  expect(btn).toBeInTheDocument();
  // Default variant=primary brings bg-mint; default size=md brings px-4.
  expect(btn).toHaveClass('bg-mint');
  expect(btn).toHaveClass('px-4');
  // Default type is "button" so the component never accidentally
  // submits a parent form.
  expect(btn).toHaveAttribute('type', 'button');
});

test('renders text children verbatim', () => {
  render(<Button>Bekreft uke</Button>);
  expect(screen.getByText('Bekreft uke')).toBeInTheDocument();
});

test('fires onClick when clicked', async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Click</Button>);
  await user.click(screen.getByRole('button'));
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('disabled blocks onClick', async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(
    <Button onClick={onClick} disabled>
      Cannot click
    </Button>
  );
  await user.click(screen.getByRole('button'));
  expect(onClick).not.toHaveBeenCalled();
  expect(screen.getByRole('button')).toBeDisabled();
});

test('loading renders the spinner with role=status', () => {
  render(<Button loading>Saving</Button>);
  expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
});

test('loading sets aria-busy on the button', () => {
  render(<Button loading>Saving</Button>);
  expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
});

test('loading disables the button even without explicit disabled prop', async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(
    <Button loading onClick={onClick}>
      Saving
    </Button>
  );
  const btn = screen.getByRole('button');
  expect(btn).toBeDisabled();
  await user.click(btn);
  expect(onClick).not.toHaveBeenCalled();
});

test('leftIcon renders before the label', () => {
  render(<Button leftIcon={<span data-testid="left">L</span>}>Label</Button>);
  const btn = screen.getByRole('button');
  expect(btn).toContainElement(screen.getByTestId('left'));
  // textContent concatenates in DOM order; leftIcon must come first.
  expect(btn.textContent).toBe('LLabel');
});

test('rightIcon renders after the label', () => {
  render(<Button rightIcon={<span data-testid="right">R</span>}>Label</Button>);
  const btn = screen.getByRole('button');
  expect(btn).toContainElement(screen.getByTestId('right'));
  expect(btn.textContent).toBe('LabelR');
});

test('loading replaces leftIcon with the spinner and hides rightIcon', () => {
  render(
    <Button
      loading
      leftIcon={<span data-testid="left">L</span>}
      rightIcon={<span data-testid="right">R</span>}
    >
      Saving
    </Button>
  );
  // Spinner is present, both icons are gone.
  expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  expect(screen.queryByTestId('left')).not.toBeInTheDocument();
  expect(screen.queryByTestId('right')).not.toBeInTheDocument();
});

test('forwardRef exposes the underlying button element', () => {
  const ref = createRef<HTMLButtonElement>();
  render(<Button ref={ref}>Click</Button>);
  expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  expect(ref.current?.textContent).toBe('Click');
});

test('variant=primary applies the mint background class', () => {
  render(<Button variant="primary">A</Button>);
  expect(screen.getByRole('button')).toHaveClass('bg-mint');
});

test('variant=secondary applies the surface background class', () => {
  render(<Button variant="secondary">A</Button>);
  expect(screen.getByRole('button')).toHaveClass('bg-surface');
});

test('variant=ghost applies the transparent background class', () => {
  render(<Button variant="ghost">A</Button>);
  expect(screen.getByRole('button')).toHaveClass('bg-transparent');
});

test('size=sm applies sm padding classes', () => {
  render(<Button size="sm">A</Button>);
  const btn = screen.getByRole('button');
  expect(btn).toHaveClass('px-3');
  expect(btn).toHaveClass('py-1.5');
});

test('size=lg applies lg padding classes', () => {
  render(<Button size="lg">A</Button>);
  const btn = screen.getByRole('button');
  expect(btn).toHaveClass('px-6');
  expect(btn).toHaveClass('py-3');
});

test('caller-supplied className is appended after base/variant/size classes', () => {
  render(<Button className="w-full">A</Button>);
  const btn = screen.getByRole('button');
  // Sanity: the variant class is still present, plus the override.
  expect(btn).toHaveClass('bg-mint');
  expect(btn).toHaveClass('w-full');
});
