'use strict';

// Phase 18 — Railway deployment config.
//
// Static-analysis tests: no network, no Railway API. Just verify that
// the checked-in config and docs are consistent with each other and
// with the server's production guards.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const RAILWAY = JSON.parse(fs.readFileSync(path.join(REPO, 'railway.json'), 'utf8'));
const ENV_EXAMPLE = fs.readFileSync(path.join(REPO, '.env.example'), 'utf8');
const DEPLOY = fs.readFileSync(path.join(REPO, 'DEPLOY.md'), 'utf8');
const DOCKERFILE = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf8');

describe('Phase 18 · railway.json', () => {
  test('uses DOCKERFILE builder', () => {
    assert.equal(RAILWAY.build.builder, 'DOCKERFILE');
    assert.equal(RAILWAY.build.dockerfilePath, 'Dockerfile');
  });

  test('health check hits /health', () => {
    assert.equal(RAILWAY.deploy.healthcheckPath, '/health');
    assert.ok(RAILWAY.deploy.healthcheckTimeout > 0);
  });

  test('restart policy is ON_FAILURE with a retry cap', () => {
    assert.equal(RAILWAY.deploy.restartPolicyType, 'ON_FAILURE');
    assert.ok(
      Number.isInteger(RAILWAY.deploy.restartPolicyMaxRetries) &&
        RAILWAY.deploy.restartPolicyMaxRetries > 0
    );
  });

  test('start command boots the app entry', () => {
    assert.equal(RAILWAY.deploy.startCommand, 'node server/index.js');
  });

  test('declares $schema for editor tooling', () => {
    assert.ok(typeof RAILWAY.$schema === 'string');
    assert.match(RAILWAY.$schema, /railway/);
  });
});

describe('Phase 18 · .env.example covers all Railway envs', () => {
  const required = [
    'APP_URL',
    'SESSION_SECRET',
    'ENCRYPTION_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'RESEND_API_KEY',
    'RESEND_FROM',
    'HTTPS_TERMINATED',
    'TRUST_PROXY',
    'SENTRY_DSN',
    'SENTRY_ENVIRONMENT',
    'SENTRY_TRACES_SAMPLE_RATE',
  ];
  for (const name of required) {
    test(`documents ${name}`, () => {
      const re = new RegExp(`(^|\\n)\\s*#?\\s*${name}=`);
      assert.match(ENV_EXAMPLE, re, `${name} must appear in .env.example`);
    });
  }
});

describe('Phase 18 · Dockerfile is Railway-friendly', () => {
  test('uses npm ci --omit=dev (no dev-deps in runtime image)', () => {
    assert.match(DOCKERFILE, /npm ci --omit=dev/);
  });

  test('sets DB_PATH under /app/data so a mounted volume persists state', () => {
    assert.match(DOCKERFILE, /ENV DB_PATH=\/app\/data\//);
  });

  test('exposes a single HTTP port', () => {
    // Default changed to 7777 in phase 22 follow-up to avoid 3000 collisions
    // on self-host machines. Any single EXPOSE line is acceptable.
    assert.match(DOCKERFILE, /^EXPOSE \d+$/m);
  });

  test('runtime entrypoint is the Node server', () => {
    // node server/index.js may live in ENTRYPOINT (distroless-style) or in CMD
    // (when ENTRYPOINT is an init shim like tini + docker-entrypoint.sh).
    assert.match(DOCKERFILE, /(ENTRYPOINT|CMD)\s*\[[^\]]*"server\/index\.js"[^\]]*\]/);
  });
});

describe('Phase 18 · DEPLOY.md Railway section', () => {
  test('has a dedicated Railway section', () => {
    assert.match(DEPLOY, /## 15\. Deploy på Railway/);
  });

  test('documents the Google OAuth redirect URI shape', () => {
    assert.match(DEPLOY, /\/api\/auth\/google\/callback/);
  });

  test('documents Resend DKIM/SPF DNS rows', () => {
    assert.match(DEPLOY, /DKIM/i);
    assert.match(DEPLOY, /SPF/i);
  });

  test('documents the volume mount path', () => {
    assert.match(DEPLOY, /\/app\/data/);
  });
});

describe('Phase 18 · Production guard is intact (no regression)', () => {
  test('NODE_ENV=production still requires AUTH_TOKEN at server boot', () => {
    const src = fs.readFileSync(path.join(REPO, 'server', 'config.js'), 'utf8');
    assert.match(src, /NODE_ENV === 'production'/);
    assert.match(src, /AUTH_TOKEN/);
  });
});

describe('Phase 18 · package.json Sentry dep is still optional', () => {
  test('@sentry/node is declared in optionalDependencies only', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    assert.ok(pkg.optionalDependencies['@sentry/node']);
    assert.ok(!pkg.dependencies['@sentry/node'], '@sentry/node must not be a hard dep');
  });
});
