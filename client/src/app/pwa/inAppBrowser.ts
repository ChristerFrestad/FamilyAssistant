// Facebook / Messenger / Instagram in-app browsers. Keep this list
// narrow — Chrome Custom Tabs and Safari must still get the PWA.

const IN_APP_BROWSER_UA = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram/i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER_UA.test(userAgent);
}
