'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseCookies,
  serializeCookie,
  clearCookie,
  appendSetCookie,
} = require('../server/auth/cookies');

test('parseCookies returns empty object for missing or empty headers', () => {
  assert.deepStrictEqual(parseCookies(null), {});
  assert.deepStrictEqual(parseCookies(undefined), {});
  assert.deepStrictEqual(parseCookies(''), {});
});

test('parseCookies splits name=value pairs separated by semicolons', () => {
  const parsed = parseCookies('fa_session=abc; theme=dark; flag=1');
  assert.deepStrictEqual(parsed, { fa_session: 'abc', theme: 'dark', flag: '1' });
});

test('parseCookies decodes URL-encoded values', () => {
  const parsed = parseCookies('greeting=hello%20world; user=%C3%98yvind');
  assert.strictEqual(parsed.greeting, 'hello world');
  assert.strictEqual(parsed.user, 'Øyvind');
});

test('parseCookies keeps the first occurrence when a key repeats', () => {
  const parsed = parseCookies('a=first; a=second');
  assert.strictEqual(parsed.a, 'first');
});

test('serializeCookie includes HttpOnly and Path by default', () => {
  const out = serializeCookie('fa_session', 'abc');
  assert.match(out, /^fa_session=abc/);
  assert.match(out, /Path=\//);
  assert.match(out, /HttpOnly/);
});

test('serializeCookie honours SameSite, Secure, Max-Age', () => {
  const out = serializeCookie('fa_session', 'xyz', {
    sameSite: 'lax',
    secure: true,
    maxAge: 3600,
  });
  assert.match(out, /SameSite=Lax/);
  assert.match(out, /Secure/);
  assert.match(out, /Max-Age=3600/);
});

test('serializeCookie URL-encodes special values', () => {
  const out = serializeCookie('u', 'hello world');
  assert.match(out, /^u=hello%20world/);
});

test('appendSetCookie handles single and array Set-Cookie headers', () => {
  const res = {
    _h: {},
    getHeader(name) {
      return this._h[name.toLowerCase()];
    },
    setHeader(name, value) {
      this._h[name.toLowerCase()] = value;
    },
  };
  appendSetCookie(res, 'a=1');
  assert.strictEqual(res.getHeader('Set-Cookie'), 'a=1');
  appendSetCookie(res, 'b=2');
  assert.deepStrictEqual(res.getHeader('Set-Cookie'), ['a=1', 'b=2']);
  appendSetCookie(res, 'c=3');
  assert.deepStrictEqual(res.getHeader('Set-Cookie'), ['a=1', 'b=2', 'c=3']);
});

test('clearCookie emits Max-Age=0 and past Expires', () => {
  const res = {
    _h: {},
    getHeader(name) {
      return this._h[name.toLowerCase()];
    },
    setHeader(name, value) {
      this._h[name.toLowerCase()] = value;
    },
  };
  clearCookie(res, 'fa_session');
  const header = res.getHeader('Set-Cookie');
  assert.match(header, /^fa_session=/);
  assert.match(header, /Max-Age=0/);
});
