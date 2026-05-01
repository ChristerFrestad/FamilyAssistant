// Tests for SettingsRow — verifies label/description rendering, badge
// surfacing, control passthrough, disabled-state semantics.

import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { SettingsRow } from './SettingsRow';

describe('SettingsRow — content', () => {
  test('renders label', () => {
    render(<SettingsRow label="Tema" />);
    expect(screen.getByText('Tema')).toBeInTheDocument();
  });

  test('renders description when provided', () => {
    render(<SettingsRow label="Tema" description="Light eller dark" />);
    expect(screen.getByText('Light eller dark')).toBeInTheDocument();
  });

  test('hides description when not provided', () => {
    render(<SettingsRow label="Tema" />);
    expect(screen.queryByText(/Light/)).toBeNull();
  });

  test('renders badge inside the label cluster', () => {
    render(<SettingsRow label="Tidssone" badge="Sprint 6" />);
    expect(screen.getByTestId('settings-row-badge').textContent).toBe('Sprint 6');
  });

  test('renders control when provided', () => {
    render(<SettingsRow label="Tema" control={<button data-testid="ctrl">click</button>} />);
    expect(screen.getByTestId('ctrl')).toBeInTheDocument();
    expect(screen.getByTestId('settings-row-control')).toBeInTheDocument();
  });

  test('omits control wrapper when no control is provided', () => {
    render(<SettingsRow label="Tema" />);
    expect(screen.queryByTestId('settings-row-control')).toBeNull();
  });
});

describe('SettingsRow — disabled state', () => {
  test('marks row disabled and dims opacity', () => {
    render(
      <SettingsRow
        label="Notifikasjoner"
        disabled
        control={<button data-testid="ctrl">x</button>}
      />
    );
    const row = screen.getByTestId('settings-row');
    expect(row.getAttribute('data-disabled')).toBe('true');
    expect(row.className).toContain('opacity-60');
  });

  test('blocks pointer-events on the control wrapper when disabled', () => {
    render(
      <SettingsRow
        label="Notifikasjoner"
        disabled
        control={<button data-testid="ctrl">x</button>}
      />
    );
    const wrapper = screen.getByTestId('settings-row-control');
    expect(wrapper.className).toContain('pointer-events-none');
    expect(wrapper.getAttribute('aria-disabled')).toBe('true');
  });

  test('leaves pointer-events alone when enabled', () => {
    render(<SettingsRow label="Tema" control={<button data-testid="ctrl">x</button>} />);
    const wrapper = screen.getByTestId('settings-row-control');
    expect(wrapper.className).not.toContain('pointer-events-none');
    expect(wrapper.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('SettingsRow — accessibility', () => {
  test('forwards ariaLabel when provided', () => {
    render(<SettingsRow label="Tema" ariaLabel="Tema-velger" />);
    const row = screen.getByTestId('settings-row');
    expect(row.getAttribute('aria-label')).toBe('Tema-velger');
  });
});
