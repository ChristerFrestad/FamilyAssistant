// Tests for the Toggle form-control. Verifies the controlled
// checked/onChange contract, the role="switch" + aria-checked
// semantics, keyboard interaction (Space toggles natively because
// it is a real checkbox under the hood), and the label/description
// rendering.

import { createRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { Toggle } from './Toggle';

test('renders an input with role=switch reflecting checked=false', () => {
  render(<Toggle checked={false} onChange={() => undefined} />);
  const sw = screen.getByRole('switch');
  expect(sw).toBeInTheDocument();
  expect(sw).not.toBeChecked();
});

test('checked=true is reflected as aria-checked / IDL checked', () => {
  render(<Toggle checked onChange={() => undefined} />);
  expect(screen.getByRole('switch')).toBeChecked();
});

test('clicking the toggle calls onChange with the inverted state', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Toggle checked={false} onChange={onChange} />);
  await user.click(screen.getByRole('switch'));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(true);
});

test('clicking the label area also toggles via the wrapping <label>', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Toggle checked={false} onChange={onChange} label="Push-varsler" />);
  // Click on the label text — the parent <label> forwards the
  // click to the wrapped input.
  await user.click(screen.getByText('Push-varsler'));
  expect(onChange).toHaveBeenCalledWith(true);
});

test('Space key toggles when the input has focus (native checkbox behavior)', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Toggle checked={false} onChange={onChange} />);
  const sw = screen.getByRole('switch');
  sw.focus();
  await user.keyboard(' ');
  expect(onChange).toHaveBeenCalledWith(true);
});

test('disabled blocks the click and does not fire onChange', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Toggle checked={false} onChange={onChange} disabled />);
  const sw = screen.getByRole('switch');
  expect(sw).toBeDisabled();
  await user.click(sw);
  expect(onChange).not.toHaveBeenCalled();
});

test('label text renders to the right of the switch when set', () => {
  render(<Toggle checked={false} onChange={() => undefined} label="Mørk modus" />);
  expect(screen.getByText('Mørk modus')).toBeInTheDocument();
});

test('description renders below the label when both are set', () => {
  render(
    <Toggle
      checked={false}
      onChange={() => undefined}
      label="Mørk modus"
      description="Bytter automatisk ved solnedgang"
    />
  );
  expect(screen.getByText('Mørk modus')).toBeInTheDocument();
  expect(screen.getByText('Bytter automatisk ved solnedgang')).toBeInTheDocument();
});

test('size=sm and size=lg apply the matching track width utilities', () => {
  // The track is the first sibling of the input in the DOM, marked
  // aria-hidden so it stays out of the accessibility tree. We reach
  // it via the input's nextElementSibling.
  const { rerender } = render(<Toggle checked={false} onChange={() => undefined} size="sm" />);
  let track = screen.getByRole('switch').nextElementSibling;
  expect(track).toHaveClass('w-9');
  expect(track).toHaveClass('h-5');

  rerender(<Toggle checked={false} onChange={() => undefined} size="lg" />);
  track = screen.getByRole('switch').nextElementSibling;
  expect(track).toHaveClass('w-14');
  expect(track).toHaveClass('h-7');
});

test('name attribute is forwarded to the underlying input for form submission', () => {
  render(<Toggle checked={false} onChange={() => undefined} name="notifications" />);
  expect(screen.getByRole('switch')).toHaveAttribute('name', 'notifications');
});

test('forwardRef exposes the underlying input element', () => {
  const ref = createRef<HTMLInputElement>();
  render(<Toggle ref={ref} checked={false} onChange={() => undefined} />);
  expect(ref.current).toBeInstanceOf(HTMLInputElement);
  // Sanity: the ref points at an input we can focus().
  ref.current?.focus();
  expect(ref.current).toHaveFocus();
});

test('controlled-pattern roundtrip: clicking flips state via parent useState', async () => {
  // End-to-end: parent owns state, Toggle reports new value, parent
  // re-renders with the new checked. Verifies that nothing in the
  // component swallows the event or double-renders.
  function Controlled(): JSX.Element {
    const [on, setOn] = useState(false);
    return <Toggle checked={on} onChange={setOn} label={on ? 'PÅ' : 'AV'} />;
  }
  const user = userEvent.setup();
  render(<Controlled />);
  expect(screen.getByText('AV')).toBeInTheDocument();
  await user.click(screen.getByRole('switch'));
  expect(screen.getByText('PÅ')).toBeInTheDocument();
  expect(screen.getByRole('switch')).toBeChecked();
});
