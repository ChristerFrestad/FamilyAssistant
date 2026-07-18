// PilotGuard: optional outermost wrapper that runs ONCE per app load.
//
// Calls GET /api/pilot/status. If the backend reports pilotMode=true
// AND pilotAuthenticated=false, the gate UI replaces children. Once
// the user enters the correct password the cookie is set, status is
// re-fetched, and children render normally.
//
// When pilotMode=false (the post-pilot default) this component is a
// thin pass-through with one fetch on mount. The status response is
// cached for the lifetime of the page so app-shell navigation does
// not retrigger the check.

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { fetchPilotStatus } from '../../auth/pilotApi';
import { PilotPasswordGate } from './PilotPasswordGate';

type GateState = { phase: 'loading' } | { phase: 'open' } | { phase: 'gated' };

export interface PilotGuardProps {
  children: React.ReactNode;
}

export function PilotGuard({ children }: PilotGuardProps): JSX.Element {
  const [state, setState] = useState<GateState>({ phase: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    fetchPilotStatus(ac.signal)
      .then((status) => {
        if (ac.signal.aborted) return;
        if (status.pilotMode && !status.pilotAuthenticated) {
          setState({ phase: 'gated' });
        } else {
          setState({ phase: 'open' });
        }
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        // Network failure — don't lock the user out; let the app try to
        // load and rely on the backend middleware to enforce the gate
        // if it's actually on.
        setState({ phase: 'open' });
      });
    return () => ac.abort();
  }, []);

  if (state.phase === 'loading') {
    // Empty splash — flash is brief because /api/pilot/status is a
    // single-property in-memory check. A spinner would create more
    // chrome than the response time justifies.
    return <div data-testid="pilot-guard-loading" />;
  }

  if (state.phase === 'gated') {
    return <PilotPasswordGate onAuthenticated={() => setState({ phase: 'open' })} />;
  }

  return <>{children}</>;
}
