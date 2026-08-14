// Minimal HTTP-router uten eksterne avhengigheter
// St\u00f8tter path-parametere (f.eks. /api/recipes/:id) og middleware-chain.
//
// Eksempel:
//   const r = createRouter();
//   r.get('/api/recipes/:id', async (ctx) => ctx.json({ id: ctx.params.id }));
//   r.post('/api/meals/swap', validateBody(swapSchema), handlers.swap);
//
// ctx-objektet:
//   { req, res, params, query, body, log, state: {} }

// errors module available via middleware chain — not needed directly in router

// ============================================================
// Path matching med :param og *
// ============================================================

function compilePath(pattern) {
  const paramNames = [];
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/\//g, '\\/')
        .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
          paramNames.push(name);
          return '([^/]+)';
        })
        .replace(/\*/g, '.*') +
      '$'
  );
  return { regex, paramNames };
}

function match(compiled, pathname) {
  const m = compiled.regex.exec(pathname);
  if (!m) return null;
  const params = {};
  compiled.paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(m[i + 1]);
  });
  return params;
}

// ============================================================
// Router
// ============================================================

function createRouter() {
  const routes = []; // { method, path, compiled, handlers: [...] }

  function register(method, pathPattern, ...handlers) {
    routes.push({
      method,
      path: pathPattern,
      compiled: compilePath(pathPattern),
      handlers,
    });
  }

  function dispatch(method, pathname) {
    for (const route of routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      const params = match(route.compiled, pathname);
      if (params) return { route, params };
    }
    return null;
  }

  async function runHandlers(ctx, handlers) {
    for (const handler of handlers) {
      const result = await handler(ctx);
      if (ctx.res.writableEnded) return;
      if (result !== undefined) {
        ctx.json(result);
        return;
      }
    }
  }

  return {
    get: (p, ...h) => register('GET', p, ...h),
    post: (p, ...h) => register('POST', p, ...h),
    put: (p, ...h) => register('PUT', p, ...h),
    patch: (p, ...h) => register('PATCH', p, ...h),
    delete: (p, ...h) => register('DELETE', p, ...h),
    all: (p, ...h) => register('ALL', p, ...h),
    routes,
    dispatch,
    runHandlers,
  };
}

module.exports = { createRouter, match, compilePath };
