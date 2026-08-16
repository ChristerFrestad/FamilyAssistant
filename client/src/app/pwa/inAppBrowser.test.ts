import { describe, expect, test } from 'vitest';
import { isInAppBrowser } from './inAppBrowser';

describe('isInAppBrowser', () => {
  test('detects Facebook and Messenger WebViews', () => {
    expect(
      isInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/10.0;]'
      )
    ).toBe(true);
    expect(
      isInAppBrowser('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 [FB_IAB/FB4A;FBAV/1.0;]')
    ).toBe(true);
  });

  test('detects Instagram', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 300.0.0')).toBe(true);
  });

  test('leaves Chrome and Safari alone', () => {
    expect(
      isInAppBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      )
    ).toBe(false);
    expect(
      isInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe(false);
  });
});
