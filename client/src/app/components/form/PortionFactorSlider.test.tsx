// Tests for the PortionFactorSlider component AND the two
// exported helpers (getPortionFactorDefault, getPortionLabel).
// Helper unit tests live alongside the component tests for the
// same reason getInitials lives next to Avatar — the helpers ship
// as part of the component's public API.

import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, vi } from 'vitest';
import {
  PortionFactorSlider,
  getPortionFactorDefault,
  getPortionLabel,
} from './PortionFactorSlider';

// ---------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------

test('renders a range slider with the controlled value', () => {
  render(<PortionFactorSlider value={1.0} onChange={() => undefined} />);
  const slider = screen.getByRole('slider');
  expect(slider).toBeInTheDocument();
  expect(slider).toHaveAttribute('type', 'range');
  expect(slider).toHaveAttribute('min', '0.2');
  expect(slider).toHaveAttribute('max', '1.5');
  expect(slider).toHaveAttribute('step', '0.1');
  expect(slider).toHaveValue('1');
});

test('numeric display shows the value formatted to one decimal', () => {
  render(<PortionFactorSlider value={1.0} onChange={() => undefined} />);
  // The string "1.0" appears in two places: the large numeric
  // display (font-display) and the centered scale label
  // (font-medium). We disambiguate by class — only the numeric
  // display uses font-display.
  const matches = screen.getAllByText('1.0');
  const numeric = matches.find((el) => el.classList.contains('font-display'));
  expect(numeric).toBeInTheDocument();
});

test('shows "voksenporsjon" when value is 1.0', () => {
  render(<PortionFactorSlider value={1.0} onChange={() => undefined} />);
  expect(screen.getByText('voksenporsjon')).toBeInTheDocument();
});

test('shows "ungdomporsjon" when value is 0.7', () => {
  render(<PortionFactorSlider value={0.7} onChange={() => undefined} />);
  expect(screen.getByText('ungdomporsjon')).toBeInTheDocument();
});

test('shows "barnporsjon" when value is 0.4', () => {
  render(<PortionFactorSlider value={0.4} onChange={() => undefined} />);
  expect(screen.getByText('barnporsjon')).toBeInTheDocument();
});

test('aria-valuetext describes the value with the role label', () => {
  render(<PortionFactorSlider value={1.0} onChange={() => undefined} />);
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '1.0 — voksenporsjon');
});

test('changing the slider value calls onChange with the parsed float', () => {
  const onChange = vi.fn();
  render(<PortionFactorSlider value={1.0} onChange={onChange} />);
  // fireEvent.change is the right tool for range inputs in jsdom —
  // user-event's drag simulation does not move the thumb in a
  // headless DOM, so we set the value directly and assert the
  // callback fires with the parsed number.
  fireEvent.change(screen.getByRole('slider'), { target: { value: '0.7' } });
  expect(onChange).toHaveBeenCalledWith(0.7);
});

test('the slider is focusable so the browser can drive keyboard navigation', () => {
  // jsdom does not actually increment a range input's value on
  // ArrowRight (browsers do), so we cannot assert onChange fires
  // from a synthetic keystroke. The contract we CAN verify here
  // is that the input is focusable — the browser's native
  // keyboard handling (Left/Right = step, Home/End = min/max)
  // is then guaranteed by the platform.
  render(<PortionFactorSlider value={0.5} onChange={() => undefined} />);
  const slider = screen.getByRole('slider');
  slider.focus();
  expect(slider).toHaveFocus();
  // tabIndex must not be -1 — that would remove the input from
  // the keyboard tab order and silently break a11y.
  expect(slider.tabIndex).toBeGreaterThanOrEqual(0);
});

test('disabled is reflected on the input', () => {
  // Native browsers gate user input (mouse + keyboard) on the
  // disabled attribute. We only verify that the attribute is set;
  // asserting that fireEvent.change is silently dropped would test
  // React's synthetic-event behavior (which DOES fire on disabled
  // for programmatic events) rather than the user-visible contract.
  render(<PortionFactorSlider value={1.0} onChange={() => undefined} disabled />);
  expect(screen.getByRole('slider')).toBeDisabled();
});

test('description prop overrides the default helper text', () => {
  render(
    <PortionFactorSlider
      value={1.0}
      onChange={() => undefined}
      description="Egendefinert tekst her"
    />
  );
  expect(screen.getByText('Egendefinert tekst her')).toBeInTheDocument();
  // The default text must NOT also render — a slider with both
  // would be visually noisy and contradictory.
  expect(screen.queryByText(/voksenporsjon \(ca 500 g/)).not.toBeInTheDocument();
});

test('default description renders when no description prop is given', () => {
  render(<PortionFactorSlider value={1.0} onChange={() => undefined} />);
  expect(screen.getByText(/voksenporsjon \(ca 500 g/)).toBeInTheDocument();
});

test('size=sm and size=lg apply different numeric text-size utilities', () => {
  // Same disambiguation as the formatted-display test — the
  // numeric span is the one with font-display. Scale labels also
  // contain "1.0" but use font-medium / text-meta.
  function findNumeric(): HTMLElement | undefined {
    return screen.getAllByText('1.0').find((el) => el.classList.contains('font-display'));
  }
  const { rerender } = render(
    <PortionFactorSlider value={1.0} onChange={() => undefined} size="sm" />
  );
  expect(findNumeric()).toHaveClass('text-display-md');
  rerender(<PortionFactorSlider value={1.0} onChange={() => undefined} size="lg" />);
  expect(findNumeric()).toHaveClass('text-hero');
});

test('forwardRef exposes the underlying input element', () => {
  const ref = createRef<HTMLInputElement>();
  render(<PortionFactorSlider ref={ref} value={1.0} onChange={() => undefined} />);
  expect(ref.current).toBeInstanceOf(HTMLInputElement);
  expect(ref.current?.type).toBe('range');
});

test('name attribute forwards to the input for form submission', () => {
  render(<PortionFactorSlider value={1.0} onChange={() => undefined} name="portion-factor" />);
  expect(screen.getByRole('slider')).toHaveAttribute('name', 'portion-factor');
});

// ---------------------------------------------------------------------
// Helper: getPortionFactorDefault
// ---------------------------------------------------------------------

test('getPortionFactorDefault: adult returns 1.0', () => {
  expect(getPortionFactorDefault('adult')).toBe(1.0);
});

test('getPortionFactorDefault: teen returns 0.7', () => {
  expect(getPortionFactorDefault('teen')).toBe(0.7);
});

test('getPortionFactorDefault: child returns 0.4', () => {
  expect(getPortionFactorDefault('child')).toBe(0.4);
});

// ---------------------------------------------------------------------
// Helper: getPortionLabel — explicit boundary tests so any future
// tweak to the bands is caught immediately.
// ---------------------------------------------------------------------

test('getPortionLabel: lower bound 0.2 maps to "barn"', () => {
  expect(getPortionLabel(0.2)).toBe('barn');
});

test('getPortionLabel: upper-of-barn-band 0.5 maps to "barn"', () => {
  expect(getPortionLabel(0.5)).toBe('barn');
});

test('getPortionLabel: lower-of-ungdom-band 0.6 maps to "ungdom"', () => {
  expect(getPortionLabel(0.6)).toBe('ungdom');
});

test('getPortionLabel: upper-of-ungdom-band 0.8 maps to "ungdom"', () => {
  expect(getPortionLabel(0.8)).toBe('ungdom');
});

test('getPortionLabel: lower-of-voksen-band 0.9 maps to "voksen"', () => {
  expect(getPortionLabel(0.9)).toBe('voksen');
});

test('getPortionLabel: upper bound 1.5 maps to "voksen"', () => {
  expect(getPortionLabel(1.5)).toBe('voksen');
});

test('getPortionLabel: out-of-range below min still snaps to "barn"', () => {
  // Defensive — the slider clamps via min/max in normal use, but the
  // helper should still produce a sensible answer if a consumer
  // calls it with a stale or computed value.
  expect(getPortionLabel(0.0)).toBe('barn');
});

test('getPortionLabel: out-of-range above max still snaps to "voksen"', () => {
  expect(getPortionLabel(2.0)).toBe('voksen');
});
