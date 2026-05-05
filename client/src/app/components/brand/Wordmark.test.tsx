// Tests for Wordmark.
//
// Verifies the cold-load contract: skeleton placeholder while config
// is loading; rendered split-color wordmark once config arrives.

import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Wordmark } from './Wordmark';
import { __resetBrandConfigCache } from '../../hooks/useBrandConfig';

const SAMPLE_CONFIG = {
  appName: 'Hverdagsplanleggeren',
  namePrimary: 'Hverdags',
  nameAccent: 'planleggeren',
  faviconLetter: 'h',
  tagline: 'Planlegg middag, gjøremål og familie',
  primaryColor: '#1F3F26',
  accentColor: '#5F8B5C',
  dotColor: '#7BA05B',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetBrandConfigCache();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('Wordmark', () => {
  test('renders an invisible skeleton while config is loading', () => {
    fetchSpy.mockReturnValueOnce(new Promise(() => undefined));
    render(<Wordmark />);
    const skeleton = screen.getByTestId('wordmark-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    // Renders no brand text during cold-load
    expect(screen.queryByText('Hverdags')).not.toBeInTheDocument();
    expect(screen.queryByText('planleggeren')).not.toBeInTheDocument();
    expect(screen.queryByText('FamilyAssistant')).not.toBeInTheDocument();
  });

  test('renders split-color wordmark once config resolves', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, SAMPLE_CONFIG));
    render(<Wordmark />);
    const mark = await waitFor(() => screen.getByTestId('wordmark'));
    expect(mark).toHaveAttribute('aria-label', 'Hverdagsplanleggeren');
    // Both halves rendered
    expect(mark.textContent).toBe('Hverdagsplanleggeren');
  });

  test('honors the size prop on the skeleton placeholder (vertical only)', () => {
    fetchSpy.mockReturnValueOnce(new Promise(() => undefined));
    render(<Wordmark size="xl" />);
    const skeleton = screen.getByTestId('wordmark-skeleton');
    // Vertical reservation keeps the header row from collapsing
    // during cold-load; horizontal width is not faked because every
    // brand's actual wordmark length is different.
    expect(skeleton.style.height).toBe('56px');
    expect(skeleton.style.minWidth).toBe('');
  });

  test('falls back to skeleton (still invisible) when fetch errors', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    render(<Wordmark />);
    // After error, config stays null → skeleton stays
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByTestId('wordmark')).not.toBeInTheDocument();
    expect(screen.getByTestId('wordmark-skeleton')).toBeInTheDocument();
  });
});
