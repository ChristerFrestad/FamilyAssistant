import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach } from 'vitest';
import { ApiTokensCard } from './ApiTokensCard';

describe('ApiTokensCard revoke', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === '/api/api-tokens' && (!init || !init.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({
              tokens: [
                { id: 1, name: 'Vegg', scopes: ['read'], revoked: false },
                { id: 2, name: 'Kjeller', scopes: ['read'], revoked: false },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );
  });

  test('each revoke button names its token and asks before revoking', async () => {
    render(<ApiTokensCard isOwner />);
    const wall = await screen.findByTestId('api-token-revoke-1');
    const cellar = screen.getByTestId('api-token-revoke-2');
    expect(wall).toHaveAttribute('aria-label', 'Trekk tilbake Vegg');
    expect(cellar).toHaveAttribute('aria-label', 'Trekk tilbake Kjeller');
    fireEvent.click(wall);
    expect(screen.getByRole('dialog')).toHaveTextContent('Vegg');
    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[1]?.method) === 'DELETE')).toBe(
      false
    );
    fireEvent.click(screen.getByTestId('api-token-revoke-confirm'));
    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[0]).endsWith('/1'))).toBe(true);
  });
});
