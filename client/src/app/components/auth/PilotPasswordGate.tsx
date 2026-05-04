// Pre-auth pilot password gate.
//
// When the backend reports pilotMode=true && pilotAuthenticated=false,
// the gate replaces the entire app surface with a single password
// form. On success the cookie is set server-side and onAuthenticated()
// fires so the parent can re-fetch status and unmount this gate.
//
// Error UX:
//   - 1-4 wrong attempts: "Feil passord. Du har {{count}} forsøk igjen."
//   - 5 wrong attempts:  "Feil passord. Du har 0 forsøk igjen."
//   - 6+ (rate-limited): "Du har forsøkt flere ganger. Christer trenger
//                         at du venter i 10 minutter for å prøve på nytt."
//
// We deliberately do NOT distinguish "wrong password" from "ran out of
// attempts" in the lockout message — once rate-limited, even the right
// password is rejected, so showing one message is honest.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { submitPilotPassword } from '../../auth/pilotApi';

export interface PilotPasswordGateProps {
  /** Called once the password was accepted and the pilot cookie is set. */
  onAuthenticated: () => void;
}

export function PilotPasswordGate({ onAuthenticated }: PilotPasswordGateProps): JSX.Element {
  const { t } = useTranslation('auth');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || lockedOut) return;
    setBusy(true);
    setError(null);

    const result = await submitPilotPassword(password);

    if (result.ok) {
      setBusy(false);
      onAuthenticated();
      return;
    }

    if (result.code === 'rate_limited') {
      setLockedOut(true);
      setError(t('pilot.password.lockout'));
    } else if (result.code === 'pilot_disabled') {
      // Backend says pilot mode is off — let the parent re-fetch status.
      onAuthenticated();
      return;
    } else if (result.code === 'network_error') {
      setError(t('pilot.password.networkError'));
    } else {
      // wrong_password
      setError(t('pilot.password.errorRemaining', { count: result.attemptsRemaining }));
      if (result.attemptsRemaining === 0) setLockedOut(true);
    }

    setPassword('');
    setBusy(false);
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-canvas-1 p-4"
      data-testid="pilot-password-gate"
    >
      <form
        className="w-full max-w-md rounded-card bg-canvas-2 p-8 shadow-mid"
        onSubmit={handleSubmit}
      >
        <h1 className="font-display text-display-md text-text-1">{t('pilot.password.title')}</h1>
        <p className="mt-2 font-body text-body text-text-2">{t('pilot.password.description')}</p>
        <label
          htmlFor="pilot-password-input"
          className="mt-6 block font-body text-meta text-text-2"
        >
          {t('pilot.password.input')}
        </label>
        <input
          id="pilot-password-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy || lockedOut}
          required
          className="mt-1 w-full rounded-pill border border-stroke bg-canvas-1 px-4 py-2 font-body text-body text-text-1"
          data-testid="pilot-password-input"
        />
        {error && (
          <p
            className="mt-3 font-body text-meta text-coral-deep"
            role="alert"
            data-testid="pilot-password-error"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || lockedOut || password.length === 0}
          className="mt-6 w-full rounded-pill bg-text-1 px-4 py-2 font-body text-body text-canvas-1 disabled:opacity-50"
          data-testid="pilot-password-submit"
        >
          {busy ? t('pilot.password.submitting') : t('pilot.password.submit')}
        </button>
      </form>
    </main>
  );
}
