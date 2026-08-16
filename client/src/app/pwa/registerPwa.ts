import { isInAppBrowser } from './inAppBrowser';

export function registerPwa(userAgent?: string): void {
  if (typeof window === 'undefined') return;
  const ua = userAgent ?? window.navigator.userAgent;
  if (isInAppBrowser(ua)) return;
  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      // Missing plugin in some test/dev paths — the app still works.
    });
}
