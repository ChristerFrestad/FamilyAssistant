import type { FormEvent, JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../base/Button';

const SCOPES = ['read', 'shopping:write', 'chores:write', 'meals:cooked'] as const;

interface TokenRow {
  id: number;
  name: string;
  scopes: string[];
  revoked: boolean;
}

export function ApiTokensCard({ isOwner }: { isOwner: boolean }): JSX.Element | null {
  const { t } = useTranslation('settings');
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([...SCOPES]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    void fetch('/api/api-tokens', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load'))))
      .then((body: { tokens: TokenRow[] }) => setTokens(body.tokens || []))
      .catch(() => setError(t('apiTokens.loadFailed')));
  }, [isOwner, t]);

  if (!isOwner) return null;

  function toggle(scope: string): void {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope]
    );
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const res = await fetch('/api/api-tokens', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes }),
    });
    if (!res.ok) {
      setError(t('apiTokens.createFailed'));
      return;
    }
    const body = (await res.json()) as {
      token: string;
      id: number;
      name: string;
      scopes: string[];
    };
    setFresh(body.token);
    setName('');
    setTokens((prev) => [
      { id: body.id, name: body.name, scopes: body.scopes, revoked: false },
      ...prev,
    ]);
  }

  async function revoke(id: number): Promise<void> {
    const res = await fetch(`/api/api-tokens/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) {
      setError(t('apiTokens.revokeFailed'));
      return;
    }
    setTokens((prev) => prev.map((row) => (row.id === id ? { ...row, revoked: true } : row)));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="api-tokens">
      <h3 className="font-display text-card text-text-1">{t('apiTokens.title')}</h3>
      <p className="font-body text-meta text-text-2">{t('apiTokens.help')}</p>
      <form className="flex flex-col gap-2" onSubmit={(event) => void create(event)}>
        <label className="font-body text-meta text-text-2" htmlFor="api-token-name">
          {t('apiTokens.name')}
          <input
            id="api-token-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 min-h-6 w-full rounded-md border border-stroke px-3"
            data-testid="api-token-name"
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-body text-meta text-text-2">{t('apiTokens.scopes')}</legend>
          {SCOPES.map((scope) => (
            <label key={scope} className="font-body text-body text-text-1">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggle(scope)}
              />{' '}
              {t(`apiTokens.scope.${scope.replace(':', '_')}`)}
            </label>
          ))}
        </fieldset>
        <Button type="submit" variant="primary" disabled={name.trim().length === 0}>
          {t('apiTokens.create')}
        </Button>
      </form>
      {fresh ? (
        <div role="status" className="flex flex-col gap-2" data-testid="api-token-once">
          <p className="font-body text-body text-text-1">{t('apiTokens.once')}</p>
          <p className="break-all font-mono text-meta">{fresh}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigator.clipboard.writeText(fresh)}
          >
            {t('apiTokens.copy')}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="font-body text-meta text-text-1">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {tokens.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2">
            <span className="font-body text-body text-text-1">
              {row.name}
              {row.revoked ? ` (${t('apiTokens.revoked')})` : ''}
            </span>
            {row.revoked ? null : (
              <Button type="button" variant="ghost" onClick={() => void revoke(row.id)}>
                {t('apiTokens.revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
