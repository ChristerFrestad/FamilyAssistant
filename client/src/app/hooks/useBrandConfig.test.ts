// Tests for useBrandConfig.
//
// Covers the cold-load contract Christer specified: hook returns
// `config: null` until /api/config resolves, then flips to the
// real value. Failure path stays at null with `error` populated.

import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBrandConfig, __resetBrandConfigCache } from './useBrandConfig';

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

describe('useBrandConfig', () => {
  test('returns config: null while fetch is pending (cold-load)', () => {
    fetchSpy.mockReturnValueOnce(new Promise(() => undefined));
    const { result } = renderHook(() => useBrandConfig());
    expect(result.current.config).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  test('flips to config + isLoading=false when /api/config resolves', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, SAMPLE_CONFIG));
    const { result } = renderHook(() => useBrandConfig());
    await waitFor(() => expect(result.current.config).not.toBeNull());
    expect(result.current.config?.appName).toBe('Hverdagsplanleggeren');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('keeps config: null + sets error when fetch fails', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    const { result } = renderHook(() => useBrandConfig());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.config).toBeNull();
    expect(result.current.error?.message).toMatch(/500/);
    expect(result.current.isLoading).toBe(false);
  });

  test('keeps config: null + sets error when response is missing fields', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { appName: 'Only' }));
    const { result } = renderHook(() => useBrandConfig());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.config).toBeNull();
    expect(result.current.error?.message).toMatch(/missing required fields/);
  });

  test('shares the cached config across re-renders without re-fetching', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, SAMPLE_CONFIG));
    const first = renderHook(() => useBrandConfig());
    await waitFor(() => expect(first.result.current.config).not.toBeNull());

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ...SAMPLE_CONFIG, appName: 'Other' }));
    const second = renderHook(() => useBrandConfig());
    expect(second.result.current.config?.appName).toBe('Hverdagsplanleggeren');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
