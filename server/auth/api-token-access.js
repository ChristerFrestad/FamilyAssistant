'use strict';

// What a family integration token may touch. Anything else is refused.
// The instance-wide AUTH_TOKEN is not a family token and is not listed here.

function scopeFor(method, pathname) {
  if (method === 'GET' && pathname === '/api/today') return 'read';
  if (
    method === 'GET' &&
    (pathname === '/api/shopping/current' || pathname === '/api/shopping/list/current')
  ) {
    return 'read';
  }
  if (method === 'GET' && pathname === '/api/chores') return 'read';
  if (method === 'POST' && /^\/api\/meals\/\d+\/mark-eaten$/.test(pathname)) return 'meals:cooked';
  if (
    (method === 'POST' &&
      (pathname === '/api/shopping/add' || pathname === '/api/shopping/items')) ||
    (method === 'PUT' && /^\/api\/shopping\/items\/\d+\/bought$/.test(pathname)) ||
    (method === 'DELETE' && /^\/api\/shopping\/items\/\d+$/.test(pathname))
  ) {
    return 'shopping:write';
  }
  if (
    method === 'PUT' &&
    (pathname === '/api/chores/complete' || pathname === '/api/chores/undone')
  ) {
    return 'chores:write';
  }
  return null;
}

function assertApiTokenAccess(ctx) {
  if (!ctx.apiToken) return;
  const need = scopeFor(ctx.req.method, ctx.pathname);
  if (!need || !ctx.apiToken.scopes.includes(need)) {
    const { errors } = require('../http/errors');
    throw errors.forbidden('Tokenet har ikke tilgang til dette.');
  }
}

module.exports = { scopeFor, assertApiTokenAccess };
