// React error boundary that prevents a single screen from crashing the
// whole shell. Uncaught render errors inside <ErrorBoundary> are caught
// here, the boundary renders a fallback card with two recovery actions
// (reload + back to dashboard), and the original error is logged once
// to the console so the runtime is still observable in dev tooling.
//
// Generic by design: takes an optional `messageKey` so different routes
// can surface different copy ("could not load shopping list", "could
// not load family", etc.). The "Tilbake til dashboard"-link uses
// react-router's Link so the page does not reload — the boundary
// state is reset by the route change. The "Reload" button
// triggers a hard reload to recover from corrupt module state.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from './Card';
import { Button } from '../base/Button';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** i18n key under common:errorBoundary that picks the message line. Defaults to 'genericMessage'. */
  messageKey?: 'shoppingMessage' | 'settingsMessage' | 'genericMessage';
  /** Test override — bypass console.error during render assertions. */
  silent?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.silent) return;
    // Single console.error call so the dev console surfaces the cause
    // without polluting the page; production telemetry can plug in here
    // later (Sprint 7 observability).
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      const messageKey = this.props.messageKey ?? 'genericMessage';
      return <ErrorBoundaryFallback messageKey={messageKey} />;
    }
    return this.props.children;
  }
}

interface FallbackProps {
  messageKey: 'shoppingMessage' | 'settingsMessage' | 'genericMessage';
}

function ErrorBoundaryFallback({ messageKey }: FallbackProps): JSX.Element {
  const { t } = useTranslation(['common']);
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-4 p-4 text-center"
      data-testid="error-boundary-fallback"
    >
      <Card padding="lg" className="flex w-full max-w-md flex-col items-center gap-3">
        <h1 className="font-display text-display-md text-text-1">
          {t('common:errorBoundary.title')}
        </h1>
        <p className="font-body text-body text-text-2">{t(`common:errorBoundary.${messageKey}`)}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={() => window.location.reload()}
            data-testid="error-boundary-retry"
          >
            {t('common:errorBoundary.retry')}
          </Button>
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-stroke bg-canvas-0 px-4 py-2 font-body text-body font-medium text-text-1 hover:bg-canvas-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0"
            data-testid="error-boundary-back"
          >
            {t('common:errorBoundary.backToDashboard')}
          </Link>
        </div>
      </Card>
    </section>
  );
}
