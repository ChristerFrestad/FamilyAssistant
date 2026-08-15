// Centralised configuration with Zod-validated env vars.
// All env vars are read and validated here. Code reads from config.X
// i stedet for process.env.X, så feil konfigurasjon fanges ved oppstart.

const fs = require('fs');
const path = require('path');
const { z } = require('zod');

// Docker Compose / Portainer pass booleans as strings ("true"/"false").
// z.coerce.boolean() uses Boolean(value), so Boolean("false") === true —
// which flipped PILOT_BYPASS and MAGIC_LINK_CONSOLE ON and crash-looped
// production deploys. Parse explicitly instead.
const envBoolean = z.preprocess((val) => {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  const s = String(val).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return undefined;
}, z.boolean());

const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(7777),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  // White-label brand-config. Sprint 10 (PR #122) made these runtime
  // env-vars and removed the old build-time-only VITE_APP_NAME path.
  // Defaults reflect the open-source FamilyAssistant brand. Operators
  // that run their own brand (e.g. the canonical Husby white-label
  // example) override every field below in their Portainer stack so the
  // same image serves any brand without rebuilding.
  //
  // See docs/BRAND_SYSTEM.md for design rules and
  // docs/operations/PORTAINER_BRANDING_SETUP.md for deploy examples.
  APP_NAME: z.string().min(1).max(40).default('FamilyAssistant'),
  APP_NAME_PRIMARY: z.string().min(1).max(20).default('Family'),
  APP_NAME_ACCENT: z.string().min(1).max(20).default('Assistant'),
  APP_FAVICON_LETTER: z
    .string()
    .length(1)
    .regex(/^[a-zA-Z]$/, 'APP_FAVICON_LETTER must be a single ASCII letter')
    .default('F'),
  APP_TAGLINE: z.string().min(1).max(80).default('Plan meals, chores and family'),
  APP_PRIMARY_COLOR: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'APP_PRIMARY_COLOR must be a 6-digit hex string (e.g. #1F3F26)')
    .default('#1F3F26'),
  APP_ACCENT_COLOR: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'APP_ACCENT_COLOR must be a 6-digit hex string')
    .default('#5F8B5C'),
  APP_DOT_COLOR: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'APP_DOT_COLOR must be a 6-digit hex string')
    .default('#7BA05B'),

  // HTTP
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576), // 1 MB
  ALLOWED_ORIGINS: z.string().default('*'),
  AUTH_TOKEN: z.string().optional(),
  // SBOM-5: token rotation. ISO-8601 date when AUTH_TOKEN was last rotated.
  // Settes manuelt i .env etter rotering. Hvis ikke satt: tolkes som "ukjent".
  AUTH_TOKEN_CREATED_AT: z.string().optional(),
  // Number of days before a token is considered "stale" and /ready flags a warning.
  // Default 90 dager (kvartalsvis rotering).
  AUTH_TOKEN_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),

  // Multi-tenant auth (Google OAuth + magic-link)
  APP_URL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().default('fa_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ENCRYPTION_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  // Pilot/MVP escape hatch: when Resend is not configured, print the magic
  // link URL to the server log instead of returning 503. Operator copies the
  // URL out of container logs and pastes it into the browser. Intended for
  // MVP pilot deploys on Portainer / self-host; disable once Resend is wired.
  MAGIC_LINK_CONSOLE: envBoolean.default(false),

  // Password auth (username/password) alongside magic-link.
  // Progressive email verification: users can register and use the app
  // immediately; after EMAIL_VERIFICATION_GRACE_SECONDS they must verify
  // email via magic link and set a new password before logging in again.
  // Default grace = 60 days. Operators can tighten for pilot/test
  // (e.g. 86400 = 24h, 3600 = 1h).
  PASSWORD_AUTH_ENABLED: envBoolean.default(true),
  PASSWORD_AUTH_OPEN_REGISTER: envBoolean.default(true),
  EMAIL_VERIFICATION_GRACE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 24 * 60 * 60), // 60 days

  // Pilot/MVP escape hatch: enable a one-click "Hopp inn som pilot" login
  // that creates a local pilot user and session without magic link or
  // OAuth. Intended for MVP self-testing where the operator is the only
  // user. Disable before any additional user touches the deploy.
  PILOT_BYPASS: envBoolean.default(false),
  // Safety belt: PILOT_BYPASS=true is refused in NODE_ENV=production
  // unless this is also set. Forces the operator to consciously ack that
  // they are running an auth-less instance in production.
  PILOT_BYPASS_PRODUCTION_ACK: envBoolean.default(false),

  // Kassal API (price comparison via kassal.app). When set, enables the
  // shopping-list-enricher background job + product-resolver so shopping
  // items get matched to Kassal products with current prices. The Kassal
  // client (server/services/kassal-client.service.js) reads
  // process.env.KASSAL_API_KEY directly at request time, so this Zod
  // entry is documentation + validation; runtime gating happens inside
  // the client. Left unset for pilot (Kassal activation is post-pilot
  // per pre-pilot-audit § C3).
  KASSAL_API_KEY: z.string().optional(),

  // Pre-auth pilot password gate (Sprint 7). When PILOT_MODE=true the
  // server requires every visitor to enter PILOT_PASSWORD before the
  // normal magic-link auth is reachable. Sets a pilot_authenticated
  // cookie (30 days) on success. Rate-limited to 5 attempts per IP per
  // 10 minutes. Disabled by default; pilot deploy sets both vars in
  // Portainer. Intended only for the 13-17 May 2026 pilot window.
  PILOT_MODE: envBoolean.default(false),
  PILOT_PASSWORD: z.string().optional(),
  // Cookie name used for the pilot-gate cookie. Distinct from the
  // session cookie because the two represent different things: the
  // pilot cookie says "this device passed the pilot gate", the session
  // cookie says "this device is logged in as a specific user".
  PILOT_COOKIE_NAME: z.string().default('fa_pilot'),
  PILOT_COOKIE_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Admin bootstrap (Sprint 7). When set, the user whose email matches
  // becomes admin (is_admin=1) on first onboarding. If left unset, the
  // first user to onboard is auto-promoted. Either path runs exactly
  // once — see server/services/admin-bootstrap.service.js and the
  // app_setup table (migration 027).
  APP_ADMIN_EMAIL: z.string().optional(),

  // LLM
  LLM_BACKEND: z.enum(['ollama', 'llamacpp']).default('ollama'),
  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  LLAMACPP_HOST: z.string().default('http://localhost:8080'),
  OLLAMA_MODEL: z.string().default('qwen2.5:3b'),
  MAX_CONTEXT_TOKENS: z.coerce.number().int().positive().default(3072),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: envBoolean.default(false),

  // Database
  DB_PATH: z.string().optional(),

  // Backup
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_KEEP_DAYS: z.coerce.number().int().positive().default(14),

  // Rate limiting (Fase 4) — global limit, applied to every request.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // Stricter per-IP limit on /api/auth/* (Sprint 1, Prompt 2). Defaults
  // to 5 attempts per 15 minutes — tight enough to slow brute-force on
  // magic-link / future OAuth callbacks, loose enough to never trip
  // legitimate users. Tuned for the pilot; revisit before scaling beyond
  // a handful of families.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),

  // Uke 5 PERF-4: Memory budget. Default 512 MB = halvparten av RPi5 4GB
  // (Pi 5 med 4 GB totalt, 2 GB reservert for andre prosesser). /ready
  // flagger warning hvis RSS overskrider dette.
  MEMORY_BUDGET_MB: z.coerce.number().int().positive().default(512),

  // Phase 17 — Sentry. Optional. If SENTRY_DSN is unset the observability
  // module is a pure no-op; no @sentry/node load is attempted.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_RELEASE: z.string().optional(),

  // Phase 22 — zero-config Docker deploy. When set to "true", the server
  // is willing to enter BOOTSTRAP_MODE if AUTH_TOKEN is missing AND no
  // persisted bootstrap.json exists AND the data volume is empty. The
  // setup wizard on /setup.html then generates and persists the token.
  // Set by docker-compose.yml; never set in a bare-metal deploy.
  BOOTSTRAP_ALLOWED: envBoolean.default(false),
  BOOTSTRAP_FILE: z.string().optional(),

  // When true, cookies get the Secure flag even if the Node process
  // itself is speaking plain HTTP (typical behind Cloudflare Tunnel /
  // Caddy / nginx TLS termination). Read via config, not raw process.env.
  HTTPS_TERMINATED: envBoolean.default(false),

  // Public marketing site (Hverdagsplanleggeren apex). Empty default:
  // every host keeps serving the SPA. Set to a comma-separated list
  // (e.g. hverdagsplanleggeren.com,www.hverdagsplanleggeren.com) in
  // the public Portainer stack only — self-hosters must not see it.
  MARKETING_HOSTS: z.string().optional().default(''),
  MARKETING_CANONICAL: z.string().optional(),
  APP_PUBLIC_URL: z.string().optional(),
});

// Auto-detect node --test and set NODE_ENV=test if not explicitly set.
// This prevents top-level require('../server/...') in test files from
// triggering production guards (AUTH_TOKEN, ALLOWED_ORIGINS) before the
// test helper has a chance to set process.env.NODE_ENV=test.
function autoDetectTestEnv() {
  if (process.env.NODE_ENV) return;
  // node --test sets NODE_TEST_CONTEXT='child' in the worker process and
  // adds 'node:test' to require.cache in the loader.
  if (process.env.NODE_TEST_CONTEXT) {
    process.env.NODE_ENV = 'test';
    return;
  }
  // Fallback: scan argv for --test
  if (
    process.argv.some((a) => a === '--test' || a === '--test-reporter' || a.startsWith('--test='))
  ) {
    process.env.NODE_ENV = 'test';
  }
}

// Phase 22 — persist-file bootstrap lookup. Returns {path, values} or null
// if the file is missing or unreadable. Values from the file are used ONLY
// to fill env-vars that the caller hasn't set explicitly, so Portainer
// variables still take precedence over persisted bootstrap values.
function loadBootstrapFile(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);
  // Docker/Portainer default mount.
  candidates.push('/app/data/bootstrap.json');
  // Local dev convenience: ./data/bootstrap.json relative to cwd.
  candidates.push(path.resolve(process.cwd(), 'data', 'bootstrap.json'));

  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.authToken) {
        return { path: p, values: parsed };
      }
    } catch {
      // ignore; try next
    }
  }
  return null;
}

function loadConfig() {
  autoDetectTestEnv();

  // Zero-config container deploy (Portainer GitHub URL → Deploy):
  // Detect Docker via /.dockerenv OR BOOTSTRAP_ALLOWED OR /app paths, then
  // ALWAYS create AUTH_TOKEN + SESSION_SECRET before any production gate.
  // Magic-link flags must never prevent the process from binding :7777.
  // Skipped only in unit tests.
  let dockerSecretsPath = null;
  let zeroConfigDeploy = false;
  const inTest = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
  if (!inTest) {
    try {
      const {
        isZeroConfigDeploy,
        ensureDockerDeploySecrets,
        scrubWeakSecretEnv,
      } = require('./auth/docker-deploy-secrets');
      scrubWeakSecretEnv();
      zeroConfigDeploy = isZeroConfigDeploy();
      if (zeroConfigDeploy) {
        const result = ensureDockerDeploySecrets({
          bootstrapFile: process.env.BOOTSTRAP_FILE,
        });
        dockerSecretsPath = result.path;
        if (result.generated.length) {
          console.warn(
            `⚠️  Docker deploy auto-created ${result.generated.join(', ')} → ${result.path}`
          );
        }
      }
    } catch (err) {
      console.warn(`⚠️  Docker deploy secret auto-create failed (${err.message})`);
      // Still mark zero-config if we look like a container so gates below skip.
      try {
        zeroConfigDeploy = require('./auth/docker-deploy-secrets').isZeroConfigDeploy();
      } catch {
        zeroConfigDeploy = false;
      }
    }
  }

  // Phase 22 — merge persisted bootstrap values INTO process.env before
  // zod parses it, unless the caller has already set them explicitly.
  const bootstrap = loadBootstrapFile(process.env.BOOTSTRAP_FILE);
  if (bootstrap) {
    const bv = bootstrap.values;
    if (bv.authToken && !process.env.AUTH_TOKEN) process.env.AUTH_TOKEN = bv.authToken;
    if (bv.allowedOrigins && !process.env.ALLOWED_ORIGINS) {
      process.env.ALLOWED_ORIGINS = bv.allowedOrigins;
    }
    if (bv.llmBackend && !process.env.LLM_BACKEND) process.env.LLM_BACKEND = bv.llmBackend;
    if (bv.ollamaHost && !process.env.OLLAMA_HOST) process.env.OLLAMA_HOST = bv.ollamaHost;
    if (bv.logLevel && !process.env.LOG_LEVEL) process.env.LOG_LEVEL = bv.logLevel;
    if (bv.sessionSecret && !process.env.SESSION_SECRET) {
      process.env.SESSION_SECRET = bv.sessionSecret;
    }
    if (process.env.NODE_ENV !== 'test') {
      try {
        const { ensureSessionSecretInBootstrapFile } = require('./auth/bootstrap-session-secret');
        const result = ensureSessionSecretInBootstrapFile(bootstrap.path);
        if (result.secret && !process.env.SESSION_SECRET) {
          process.env.SESSION_SECRET = result.secret;
        }
      } catch (err) {
        console.warn(
          `⚠️  SESSION_SECRET self-heal failed (${err.message}). ` +
            `Set SESSION_SECRET in env or fix file permissions on bootstrap.json.`
        );
      }
    }
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('\u26a0\ufe0f  Ugyldig milj\u00f8-konfigurasjon:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  const cfg = parsed.data;

  // Derivert: pretty-printing bare i dev hvis ikke eksplisitt satt
  if (cfg.NODE_ENV === 'development' && !process.env.LOG_PRETTY) {
    cfg.LOG_PRETTY = true;
  }

  // ALLOWED_ORIGINS kan være komma-separert liste eller '*'
  cfg.ALLOWED_ORIGINS_LIST =
    cfg.ALLOWED_ORIGINS === '*'
      ? '*'
      : cfg.ALLOWED_ORIGINS.split(',')
          .map((s) => s.trim())
          .filter(Boolean);

  // Marketing host set — lowercase, port stripped. Empty = off.
  cfg.MARKETING_HOST_SET = new Set(
    String(cfg.MARKETING_HOSTS || '')
      .split(',')
      .map((s) => s.split(':')[0].trim().toLowerCase())
      .filter(Boolean)
  );
  cfg.APP_PUBLIC_ORIGIN = String(cfg.APP_PUBLIC_URL || cfg.APP_URL || '')
    .trim()
    .replace(/\/$/, '');

  // Full app starts immediately — no interactive deploy wizard gate.
  cfg.BOOTSTRAP_MODE = false;
  cfg.BOOTSTRAP_FILE_PATH = bootstrap?.path || dockerSecretsPath || null;

  // -------------------------------------------------------------------------
  // CONTAINER PATH (Portainer / Docker / Cloudflare Tunnel)
  // Never process.exit(1) for missing secrets or leftover pilot flags.
  // Operator goal: GitHub URL → Deploy → :7777 listens.
  // -------------------------------------------------------------------------
  const dockerDeploy = Boolean(cfg.BOOTSTRAP_ALLOWED) || zeroConfigDeploy;

  if (dockerDeploy) {
    // Secrets must always exist so magic-link / sessions work later.
    if (!cfg.SESSION_SECRET || cfg.SESSION_SECRET.length < 32) {
      cfg.SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');
      process.env.SESSION_SECRET = cfg.SESSION_SECRET;
    }
    if (!cfg.AUTH_TOKEN || cfg.AUTH_TOKEN.length < 16) {
      cfg.AUTH_TOKEN = require('crypto').randomBytes(32).toString('hex');
      process.env.AUTH_TOKEN = cfg.AUTH_TOKEN;
    }
    // Leftover Portainer env PILOT_BYPASS=true (or the old "false"→true
    // coerce bug) must not kill the container. Force off unless ACK is set.
    if (cfg.PILOT_BYPASS && !cfg.PILOT_BYPASS_PRODUCTION_ACK) {
      console.warn(
        '⚠️  PILOT_BYPASS ignored in container deploy (no PRODUCTION_ACK) — forced false so :7777 can bind.'
      );
      cfg.PILOT_BYPASS = false;
      process.env.PILOT_BYPASS = 'false';
    }
    // Incomplete Google OAuth env is ignored in container (don't exit).
    if (cfg.GOOGLE_CLIENT_ID && (!cfg.GOOGLE_CLIENT_SECRET || !cfg.APP_URL)) {
      console.warn(
        '⚠️  Incomplete Google OAuth env ignored in container deploy (missing secret or APP_URL).'
      );
    }
    if (cfg.ENCRYPTION_KEY && cfg.ENCRYPTION_KEY.length !== 64) {
      console.warn('⚠️  Invalid ENCRYPTION_KEY length ignored in container deploy.');
      delete process.env.ENCRYPTION_KEY;
      cfg.ENCRYPTION_KEY = undefined;
    }
  } else {
    // -----------------------------------------------------------------------
    // BARE-METAL PATH — strict production gates
    // -----------------------------------------------------------------------
    if (cfg.NODE_ENV === 'production' && !cfg.AUTH_TOKEN && !cfg.PILOT_BYPASS) {
      console.error('\u26a0\ufe0f  AUTH_TOKEN er p\u00e5krevd n\u00e5r NODE_ENV=production');
      process.exit(1);
    }
    if (cfg.AUTH_TOKEN && cfg.AUTH_TOKEN.length < 16) {
      console.error('\u26a0\ufe0f  AUTH_TOKEN er for kort (minst 16 tegn, helst 32+)');
      process.exit(1);
    }
    if (cfg.NODE_ENV === 'production' && cfg.ALLOWED_ORIGINS_LIST === '*' && !cfg.PILOT_BYPASS) {
      console.error('\u26a0\ufe0f  ALLOWED_ORIGINS=* er ikke tillatt i production');
      process.exit(1);
    }
    if (cfg.SESSION_SECRET && cfg.SESSION_SECRET.length < 32) {
      console.error('⚠️  SESSION_SECRET must be at least 32 hex chars (16 bytes).');
      process.exit(1);
    }
    if (cfg.ENCRYPTION_KEY && cfg.ENCRYPTION_KEY.length !== 64) {
      console.error('⚠️  ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes).');
      process.exit(1);
    }
    if (cfg.GOOGLE_CLIENT_ID && !cfg.GOOGLE_CLIENT_SECRET) {
      console.error('⚠️  GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is missing.');
      process.exit(1);
    }
    if (cfg.GOOGLE_CLIENT_ID && !cfg.APP_URL) {
      console.error('⚠️  GOOGLE_CLIENT_ID requires APP_URL for redirect URI construction.');
      process.exit(1);
    }
    const hmacSigningEnabled = cfg.GOOGLE_CLIENT_ID || cfg.RESEND_API_KEY || cfg.MAGIC_LINK_CONSOLE;
    if (cfg.NODE_ENV === 'production' && hmacSigningEnabled && !cfg.SESSION_SECRET) {
      console.error(
        '⚠️  SESSION_SECRET is required in production when Google OAuth, ' +
          'magic-link email, or MAGIC_LINK_CONSOLE is enabled.'
      );
      process.exit(1);
    }
    if (cfg.NODE_ENV === 'production' && cfg.GOOGLE_CLIENT_ID && !cfg.ENCRYPTION_KEY) {
      console.error('⚠️  ENCRYPTION_KEY is required in production when Google OAuth is enabled.');
      process.exit(1);
    }
    // Bare-metal: refuse unacked PILOT_BYPASS in production.
    if (cfg.PILOT_BYPASS && cfg.NODE_ENV === 'production' && !cfg.PILOT_BYPASS_PRODUCTION_ACK) {
      console.error('⚠️  PILOT_BYPASS=true is refused in NODE_ENV=production.');
      console.error('   This disables all auth — set PILOT_BYPASS_PRODUCTION_ACK=true');
      console.error('   ONLY if you deliberately want an unauthenticated server.');
      process.exit(1);
    }
  }

  if (cfg.PILOT_BYPASS && cfg.NODE_ENV !== 'test') {
    console.warn('⚠️  PILOT_BYPASS is ON — /api/auth/pilot-login grants a session');
    console.warn('   to anyone who calls it. Turn off before adding real users.');
  }

  // Development/test fallbacks: auto-generate ephemeral secrets so tests run
  // without forcing every env var to be set. These are NOT suitable for
  // production but they let local dev and unit tests proceed.
  if (!cfg.SESSION_SECRET && cfg.NODE_ENV !== 'production') {
    cfg.SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');
  }
  if (!cfg.ENCRYPTION_KEY && cfg.NODE_ENV !== 'production') {
    cfg.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
    // Side-effect: expose to env so crypto.js picks it up.
    process.env.ENCRYPTION_KEY = cfg.ENCRYPTION_KEY;
  }

  // Sprint 10 — brand cross-validation. Surfaces operator typos in the
  // wordmark / favicon env-vars without crashing the server, since an
  // operator may have a deliberate mismatch (e.g. APP_NAME with a space
  // vs primary+accent without). Tests skip the warnings so test
  // fixtures don't pollute output.
  cfg.BRAND_WARNINGS = collectBrandWarnings(cfg);
  if (cfg.NODE_ENV !== 'test') {
    for (const w of cfg.BRAND_WARNINGS) {
      console.warn(`⚠️  brand-config: ${w}`);
    }
  }

  return Object.freeze(cfg);
}

// Returns an array of human-readable warnings about brand-config
// inconsistencies. Empty array means everything is consistent. Pure
// function — no side effects — so callers can format the output (boot-
// log, /ready endpoint, tests) however they like.
//
// Cross-checks (per docs/BRAND_SYSTEM.md):
//   1. APP_NAME == APP_NAME_PRIMARY + APP_NAME_ACCENT
//      (case-insensitive, whitespace stripped)
//   2. APP_FAVICON_LETTER == first letter of APP_NAME_PRIMARY
//      (case-insensitive)
//   3. RESEND_FROM "name" part == APP_NAME (case-insensitive)
//      (only checked when RESEND_FROM is set; format is either bare
//      "addr@domain" or "Name <addr@domain>")
function collectBrandWarnings(cfg) {
  const warnings = [];

  const concat = `${cfg.APP_NAME_PRIMARY}${cfg.APP_NAME_ACCENT}`;
  const expectedName = cfg.APP_NAME.replace(/\s+/g, '');
  if (concat.toLowerCase() !== expectedName.toLowerCase()) {
    warnings.push(
      `APP_NAME ("${cfg.APP_NAME}") does not match APP_NAME_PRIMARY+APP_NAME_ACCENT ` +
        `("${concat}"). Wordmark and meta-tags will display different names.`
    );
  }

  const expectedLetter = cfg.APP_NAME_PRIMARY.charAt(0);
  if (cfg.APP_FAVICON_LETTER.toLowerCase() !== expectedLetter.toLowerCase()) {
    warnings.push(
      `APP_FAVICON_LETTER ("${cfg.APP_FAVICON_LETTER}") does not match the first letter ` +
        `of APP_NAME_PRIMARY ("${expectedLetter}"). Favicon and wordmark will mismatch.`
    );
  }

  if (cfg.RESEND_FROM) {
    const fromName = parseFromName(cfg.RESEND_FROM);
    if (fromName && fromName.toLowerCase() !== cfg.APP_NAME.toLowerCase()) {
      warnings.push(
        `RESEND_FROM display-name ("${fromName}") does not match APP_NAME ("${cfg.APP_NAME}"). ` +
          `Recipients will see emails from a different brand than the one rendered in-app.`
      );
    }
  }

  return warnings;
}

// Extracts the human-readable name from a RFC 5322 mailbox-style
// `Name <addr@domain>` string. Returns null if the input is a bare
// address (no display name).
function parseFromName(resendFrom) {
  const match = String(resendFrom).match(/^\s*(.+?)\s*<[^>]+>\s*$/);
  return match ? match[1].trim() : null;
}

const config = loadConfig();

module.exports = {
  config,
  // Exported for tests so RFC 5322 mailbox-edge-cases can be
  // exercised without spinning up a full config-load round-trip.
  __parseFromName: parseFromName,
  __collectBrandWarnings: collectBrandWarnings,
};
