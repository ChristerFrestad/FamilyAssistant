// Sprint 10 — runtime brand-config hook.
//
// Fetches GET /api/config once per session and caches the result in
// module-scope so every consumer of the hook in the React tree shares
// one source of truth (and one network round-trip).
//
// Cold-load contract per Christer's guidance: `config` is `null` until
// the fetch resolves. Components that render brand-strings should
// reserve space (skeleton / invisible placeholder) instead of falling
// back to "FamilyAssistant" — better blank for ~200ms than the wrong
// brand for 200ms. Do not export a default-config object.
//
// Failure handling: if the fetch fails, `config` stays `null` and
// `error` flips true. AppShell and friends keep rendering their
// chrome; only the wordmark/title surface is degraded. The browser
// tab keeps the default <title> from index.html, the Wordmark stays
// invisible.

import { useEffect, useState } from 'react';

export interface BrandConfig {
  appName: string;
  namePrimary: string;
  nameAccent: string;
  faviconLetter: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  dotColor: string;
}

export interface UseBrandConfigResult {
  config: BrandConfig | null;
  isLoading: boolean;
  error: Error | null;
}

let cachedConfig: BrandConfig | null = null;
let pendingFetch: Promise<BrandConfig> | null = null;
let lastError: Error | null = null;

// Imperatively reset the module-level cache. Tests use this between
// runs; production code should never call it.
export function __resetBrandConfigCache(): void {
  cachedConfig = null;
  pendingFetch = null;
  lastError = null;
}

function hasAllFields(value: unknown): value is BrandConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.appName === 'string' &&
    typeof v.namePrimary === 'string' &&
    typeof v.nameAccent === 'string' &&
    typeof v.faviconLetter === 'string' &&
    typeof v.tagline === 'string' &&
    typeof v.primaryColor === 'string' &&
    typeof v.accentColor === 'string' &&
    typeof v.dotColor === 'string'
  );
}

async function fetchBrandConfig(): Promise<BrandConfig> {
  const res = await fetch('/api/config', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`GET /api/config returned ${res.status}`);
  }
  const data: unknown = await res.json();
  if (!hasAllFields(data)) {
    throw new Error('GET /api/config response is missing required fields');
  }
  return data;
}

export function useBrandConfig(): UseBrandConfigResult {
  const [config, setConfig] = useState<BrandConfig | null>(cachedConfig);
  const [isLoading, setIsLoading] = useState<boolean>(cachedConfig === null);
  const [error, setError] = useState<Error | null>(lastError);

  useEffect(() => {
    if (cachedConfig) {
      setConfig(cachedConfig);
      setIsLoading(false);
      return;
    }

    if (!pendingFetch) {
      pendingFetch = fetchBrandConfig();
    }

    let cancelled = false;
    pendingFetch
      .then((next) => {
        cachedConfig = next;
        if (cancelled) return;
        setConfig(next);
        setError(null);
        setIsLoading(false);
      })
      .catch((err: Error) => {
        lastError = err;
        if (cancelled) return;
        setError(err);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { config, isLoading, error };
}
