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

function loadConfig() {
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
  cfg.ALLOWED_ORIGINS_LIST = cfg.ALLOWED_ORIGINS === '*'
    ? '*'
    : cfg.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);

  return Object.freeze(cfg);
}

const config = loadConfig();

module.exports = { config };
