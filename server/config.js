// Sentralisert konfigurasjon med Zod-validert env
// Alle env-variabler leses og valideres hér. Koden leser fra config.X
// i stedet for process.env.X, s\u00e5 feil konfigurasjon fanges ved oppstart.

const { z } = require('zod');

const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  // HTTP
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576), // 1 MB
  ALLOWED_ORIGINS: z.string().default('*'),
  AUTH_TOKEN: z.string().optional(),
  // SBOM-5: token-rotation. ISO-8601 dato når AUTH_TOKEN sist ble rotert.
  // Settes manuelt i .env etter rotering. Hvis ikke satt: tolkes som "ukjent".
  AUTH_TOKEN_CREATED_AT: z.string().optional(),
  // Antall dager før en token anses "stale" og /ready flagger warning.
  // Default 90 dager (kvartalsvis rotering).
  AUTH_TOKEN_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),

  // LLM
  LLM_BACKEND: z.enum(['ollama', 'llamacpp']).default('ollama'),
  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  LLAMACPP_HOST: z.string().default('http://localhost:8080'),
  OLLAMA_MODEL: z.string().default('qwen2.5:3b'),
  MAX_CONTEXT_TOKENS: z.coerce.number().int().positive().default(3072),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),

  // Database
  DB_PATH: z.string().optional(),

  // Backup
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_KEEP_DAYS: z.coerce.number().int().positive().default(14),

  // Rate limiting (Fase 4)
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

// Auto-detekter node --test og sett NODE_ENV=test hvis ikke eksplisitt satt.
// Dette hindrer at top-level require('../server/...') i testfiler triggerer
// produksjons-guardene (AUTH_TOKEN, ALLOWED_ORIGINS) før test-helperen rekker
// å sette process.env.NODE_ENV=test.
function autoDetectTestEnv() {
  if (process.env.NODE_ENV) return;
  // node --test setter NODE_TEST_CONTEXT='child' i worker-prosessen og
  // legger 'node:test' i require.cache hos loaderen.
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

function loadConfig() {
  autoDetectTestEnv();
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

  // ALLOWED_ORIGINS kan v\u00e6re komma-separert liste eller '*'
  cfg.ALLOWED_ORIGINS_LIST =
    cfg.ALLOWED_ORIGINS === '*'
      ? '*'
      : cfg.ALLOWED_ORIGINS.split(',')
          .map((s) => s.trim())
          .filter(Boolean);

  // Produksjons-krav: AUTH_TOKEN MÅ v\u00e6re satt hvis NODE_ENV=production.
  // Hindrer \u00e5pen RPi5 p\u00e5 nettet uten autentisering.
  if (cfg.NODE_ENV === 'production' && !cfg.AUTH_TOKEN) {
    console.error('\u26a0\ufe0f  AUTH_TOKEN er p\u00e5krevd n\u00e5r NODE_ENV=production');
    console.error('   Sett en sterk token (minst 32 tegn) i .env eller systemd.');
    console.error('   Eksempel: openssl rand -hex 32 > token.txt');
    process.exit(1);
  }
  if (cfg.AUTH_TOKEN && cfg.AUTH_TOKEN.length < 16) {
    console.error('\u26a0\ufe0f  AUTH_TOKEN er for kort (minst 16 tegn, helst 32+)');
    process.exit(1);
  }

  // CORS-hardening: kan ikke bruke '*' samtidig med AUTH_TOKEN i production
  if (cfg.NODE_ENV === 'production' && cfg.ALLOWED_ORIGINS_LIST === '*') {
    console.error('\u26a0\ufe0f  ALLOWED_ORIGINS=* er ikke tillatt i production');
    console.error('   Sett en komma-separert liste med tillatte origins.');
    process.exit(1);
  }

  return Object.freeze(cfg);
}

const config = loadConfig();

module.exports = { config };
