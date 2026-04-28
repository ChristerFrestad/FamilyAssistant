// Tests for the Field component. Verifies that label binding,
// aria-describedby wiring, aria-invalid, and child-own-prop
// preservation all behave as the contract documents.

import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Field } from './Field';

test('renders the label text', () => {
  render(
    <Field label="E-post">
      <input type="email" />
    </Field>
  );
  // The label text appears verbatim in the DOM. Substring match
  // because a required asterisk would be appended in other tests.
  expect(screen.getByText(/E-post/)).toBeInTheDocument();
});

test('hint renders below the input when set', () => {
  render(
    <Field label="E-post" hint="Vi sender bekreftelseslenke hit">
      <input type="email" />
    </Field>
  );
  expect(screen.getByText('Vi sender bekreftelseslenke hit')).toBeInTheDocument();
});

test('error overrides hint when both are set', () => {
  render(
    <Field label="E-post" hint="hint text" error="error text">
      <input type="email" />
    </Field>
  );
  expect(screen.getByText('error text')).toBeInTheDocument();
  expect(screen.queryByText('hint text')).not.toBeInTheDocument();
});

test('required renders a visible asterisk after the label', () => {
  render(
    <Field label="Familienavn" required>
      <input type="text" />
    </Field>
  );
  // The asterisk is its own span so we can find it by exact text "*".
  expect(screen.getByText('*')).toBeInTheDocument();
});

test('required asterisk has aria-hidden=true so screen readers ignore it', () => {
  render(
    <Field label="Familienavn" required>
      <input type="text" />
    </Field>
  );
  expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
});

test('generated id binds the label to the input via htmlFor / id', () => {
  render(
    <Field label="E-post">
      <input type="email" />
    </Field>
  );
  // getByLabelText resolves the htmlFor->id binding; if the id is
  // missing or different, this throws.
  const input = screen.getByLabelText(/E-post/);
  expect(input).toBeInstanceOf(HTMLInputElement);
});

test('aria-describedby on the input points at the hint when hint is set', () => {
  render(
    <Field label="E-post" hint="Hint here">
      <input type="email" data-testid="input" />
    </Field>
  );
  const input = screen.getByTestId('input');
  const id = input.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  expect(document.getElementById(id as string)).toHaveTextContent('Hint here');
});

test('aria-describedby on the input points at the error when error is set', () => {
  render(
    <Field label="E-post" error="Bad value">
      <input type="email" data-testid="input" />
    </Field>
  );
  const input = screen.getByTestId('input');
  const id = input.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  expect(document.getElementById(id as string)).toHaveTextContent('Bad value');
});

test('aria-invalid is set on the input when error is present', () => {
  render(
    <Field label="E-post" error="Bad value">
      <input type="email" data-testid="input" />
    </Field>
  );
  expect(screen.getByTestId('input')).toHaveAttribute('aria-invalid', 'true');
});

test('error message is rendered with role=alert for assistive tech', () => {
  render(
    <Field label="E-post" error="Bad value">
      <input type="email" />
    </Field>
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Bad value');
});

test('children-own id is preserved over the generated one', () => {
  render(
    <Field label="E-post">
      <input type="email" id="custom-id" data-testid="input" />
    </Field>
  );
  const input = screen.getByTestId('input');
  expect(input).toHaveAttribute('id', 'custom-id');
  // The label htmlFor must follow the preserved id, otherwise the
  // accessibility binding silently breaks. getByLabelText resolves
  // the htmlFor->id pair and returns the labeled element; if the
  // pairing is broken, the query throws.
  expect(screen.getByLabelText(/E-post/)).toBe(input);
});

test('children-own required={false} wins over Field required prop', () => {
  // Field says required, child says explicitly not required. The
  // child's explicit value must win — otherwise consumers cannot
  // selectively opt out per input.
  render(
    <Field label="E-post" required>
      <input type="email" required={false} data-testid="input" />
    </Field>
  );
  expect(screen.getByTestId('input')).not.toBeRequired();
});

test('Field required propagates to a child without an explicit required prop', () => {
  render(
    <Field label="E-post" required>
      <input type="email" data-testid="input" />
    </Field>
  );
  expect(screen.getByTestId('input')).toBeRequired();
});

test('wraps a textarea via the children-pattern', () => {
  render(
    <Field label="Notes" hint="Optional notes">
      <textarea data-testid="ta" />
    </Field>
  );
  const ta = screen.getByTestId('ta');
  expect(ta.tagName).toBe('TEXTAREA');
  // The label binding goes through the same useId path that an
  // <input> uses, so getByLabelText must still locate the textarea.
  expect(screen.getByLabelText(/Notes/)).toBe(ta);
});
