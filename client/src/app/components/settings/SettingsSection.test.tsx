// Tests for SettingsSection — verifies title, optional description,
// children rendering, and aria-labelledby wiring.

import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { SettingsSection } from './SettingsSection';

describe('SettingsSection', () => {
  test('renders title and children', () => {
    render(
      <SettingsSection title="System">
        <div data-testid="child">child content</div>
      </SettingsSection>
    );
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  test('renders optional description under the title', () => {
    render(
      <SettingsSection title="System" description="System-wide preferences">
        <div />
      </SettingsSection>
    );
    expect(screen.getByText('System-wide preferences')).toBeInTheDocument();
  });

  test('hides description when not provided', () => {
    render(
      <SettingsSection title="System">
        <div />
      </SettingsSection>
    );
    // Heading is the only paragraph-ish text in this case.
    expect(screen.queryByText(/System-wide/)).toBeNull();
  });

  test('wires aria-labelledby when id is provided', () => {
    render(
      <SettingsSection title="System" id="system">
        <div data-testid="body" />
      </SettingsSection>
    );
    const heading = screen.getByRole('heading', { name: 'System' });
    expect(heading.id).toBe('system-heading');
  });

  test('section uses h2 heading level', () => {
    render(
      <SettingsSection title="Family">
        <div />
      </SettingsSection>
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Family' })).toBeInTheDocument();
  });
});
