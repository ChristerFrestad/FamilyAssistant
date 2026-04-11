/**
 * Fase F6 — .env-skriving med trelags-forsvar.
 *
 * Sikkerhet:
 *   1. WHITELIST — kun 6 kjente nøkler kan skrives
 *   2. FORMAT-VALIDATOR — hver nøkkel har eget regex for format
 *   3. SANITIZE — avvis newlines, null-bytes, control chars, shell-metategn i
 *                  sensitive posisjoner, maks 500 tegn
 *   4. FIL-LOCK — forenklet process-intern mutex (single-instance server)
 *   5. ATOMIC WRITE — skriv til .env.tmp → rename
 *   6. BACKUP — kopier til .env.bak før hver skriving
 *
 * Config-reload:
 *   Hybrid — inline for keys som leses per-request, restart-required for
 *   keys som bindes ved modul-init (OLLAMA_URL).
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(process.cwd(), '.env');
const BACKUP_PATH = ENV_PATH + '.bak';
const TMP_PATH = ENV_PATH + '.tmp';

const WHITELIST = [
  'KASSAL_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OLLAMA_URL',
  'LLM_BACKEND',
];

// Hvilke keys kan reloades inline uten server-restart
const INLINE_RELOAD_KEYS = [
  'KASSAL_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'LLM_BACKEND',
];

const FORMAT_VALIDATORS = {
  KASSAL_API_KEY: /^[a-zA-Z0-9_\-.]{10,200}$/,
  OPENAI_API_KEY: /^sk-[a-zA-Z0-9_\-.]{10,200}$/,
  XAI_API_KEY: /^xai-[a-zA-Z0-9_\-.]{10,200}$/,
  ANTHROPIC_API_KEY: /^sk-ant-[a-zA-Z0-9_\-.]{10,200}$/,
  OLLAMA_URL: /^https?:\/\/[a-zA-Z0-9.:/_\-]{3,200}$/,
  LLM_BACKEND: /^(anthropic|openai|xai|ollama|none|disabled)$/,
};

// Process-intern mutex for samtidig skrive-beskyttelse
let writeLock = false;
const waitingWrites = [];

function acquireLock() {
  return new Promise((resolve) => {
    if (!writeLock) {
      writeLock = true;
      resolve();
    } else {
      waitingWrites.push(resolve);
    }
  });
}

function releaseLock() {
  if (waitingWrites.length > 0) {
    const next = waitingWrites.shift();
    next();
  } else {
    writeLock = false;
  }
}

// ============================================================
// Sanitize
// ============================================================

const FORBIDDEN_CHARS = /[\n\r\0\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function sanitize(value) {
  if (typeof value !== 'string') {
    throw new Error('Verdi må være en streng');
  }
  if (value.length === 0) {
    throw new Error('Verdi kan ikke være tom');
  }
  if (value.length > 500) {
    throw new Error('Verdi er for lang (maks 500 tegn)');
  }
  if (FORBIDDEN_CHARS.test(value)) {
    throw new Error('Verdi inneholder ugyldige tegn (newlines, null-bytes eller control chars)');
  }
  // Ikke tillat dobbelt-quote i verdi — ville bryte kvoting
  if (value.includes('"')) {
    throw new Error('Verdi kan ikke inneholde anførselstegn');
  }
  return value;
}

// ============================================================
// Maskering for lesing
// ============================================================

function mask(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 6) return '●'.repeat(value.length);
  const visible = value.slice(-4);
  return '●'.repeat(Math.min(10, value.length - 4)) + '•' + visible;
}

// ============================================================
// Read (maskert)
// ============================================================

function parseEnvFile(content) {
  const result = {};
  if (!content) return result;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip quotes
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function readMasked() {
  const result = {};
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (err) {
    // Fil finnes ikke → returner null for alle whitelisted
    for (const key of WHITELIST) result[key] = null;
    return result;
  }
  const parsed = parseEnvFile(content);
  for (const key of WHITELIST) {
    const v = parsed[key] || process.env[key];
    result[key] = v ? mask(v) : null;
  }
  return result;
}

// ============================================================
// Write
// ============================================================

async function write(key, value) {
  if (!WHITELIST.includes(key)) {
    throw new Error(`Ukjent nøkkel '${key}'. Tillatt: ${WHITELIST.join(', ')}`);
  }
  const clean = sanitize(value);
  const validator = FORMAT_VALIDATORS[key];
  if (validator && !validator.test(clean)) {
    throw new Error(`Ugyldig format for ${key}`);
  }

  await acquireLock();
  try {
    // Backup
    if (fs.existsSync(ENV_PATH)) {
      try {
        fs.copyFileSync(ENV_PATH, BACKUP_PATH);
      } catch (err) {
        // Ikke fatal — fortsett
      }
    }

    // Les eksisterende innhold
    let content = '';
    try {
      content = fs.readFileSync(ENV_PATH, 'utf8');
    } catch {
      /* tom fil */
    }

    const lines = content ? content.split(/\r?\n/) : [];
    const newLine = `${key}="${clean}"`;
    const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (idx >= 0) {
      lines[idx] = newLine;
    } else {
      // Hvis siste linje er tom, erstatt den, ellers append
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines[lines.length - 1] = newLine;
        lines.push('');
      } else {
        lines.push(newLine);
      }
    }

    // Atomic write: skriv til tmp, deretter rename
    const newContent = lines.join('\n');
    fs.writeFileSync(TMP_PATH, newContent, { mode: 0o600 });
    fs.renameSync(TMP_PATH, ENV_PATH);

    // Inline update av process.env hvis reloadable
    const requiresRestart = !INLINE_RELOAD_KEYS.includes(key);
    if (!requiresRestart) {
      process.env[key] = clean;
    }

    return {
      ok: true,
      key,
      masked: mask(clean),
      requiresRestart,
    };
  } finally {
    // Rydd opp tmp hvis den fortsatt finnes (skal ikke skje etter rename)
    try {
      if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH);
    } catch {}
    releaseLock();
  }
}

// ============================================================
// Integration-test helpers
// ============================================================

/**
 * Kjører en live-health-check mot den gitte integrasjonen.
 * Returnerer {ok, latencyMs, error}.
 */
async function testIntegration(name) {
  const start = Date.now();
  try {
    switch (name) {
      case 'kassal': {
        const key = process.env.KASSAL_API_KEY;
        if (!key) return { ok: false, error: 'Ingen API-nøkkel satt' };
        // Lettvekts-sjekk: HEAD/GET mot et Kassal-endpoint
        const url = 'https://kassal.app/api/v1/products?search=melk&size=1';
        const r = await fetchWithTimeout(
          url,
          { headers: { Authorization: `Bearer ${key}` } },
          5000
        );
        if (r.ok) return { ok: true, latencyMs: Date.now() - start };
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
      }
      case 'openai': {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return { ok: false, error: 'Ingen API-nøkkel satt' };
        const r = await fetchWithTimeout(
          'https://api.openai.com/v1/models',
          {
            headers: { Authorization: `Bearer ${key}` },
          },
          5000
        );
        if (r.ok) return { ok: true, latencyMs: Date.now() - start };
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
      }
      case 'anthropic': {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return { ok: false, error: 'Ingen API-nøkkel satt' };
        // Anthropic krever POST for chat, men vi kan bruke et minimalt probe
        const r = await fetchWithTimeout(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-3-5-haiku-20241022',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }],
            }),
          },
          5000
        );
        if (r.ok || r.status === 400) return { ok: true, latencyMs: Date.now() - start };
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
      }
      case 'xai': {
        const key = process.env.XAI_API_KEY;
        if (!key) return { ok: false, error: 'Ingen API-nøkkel satt' };
        const r = await fetchWithTimeout(
          'https://api.x.ai/v1/models',
          {
            headers: { Authorization: `Bearer ${key}` },
          },
          5000
        );
        if (r.ok) return { ok: true, latencyMs: Date.now() - start };
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
      }
      case 'ollama': {
        const url = process.env.OLLAMA_URL || 'http://localhost:11434';
        const r = await fetchWithTimeout(`${url}/api/tags`, {}, 3000);
        if (r.ok) return { ok: true, latencyMs: Date.now() - start };
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
      }
      default:
        return { ok: false, error: `Ukjent integrasjon: ${name}` };
    }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message || 'Ukjent feil' };
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  WHITELIST,
  INLINE_RELOAD_KEYS,
  readMasked,
  write,
  mask,
  sanitize,
  testIntegration,
  parseEnvFile,
  // Test-only exports
  _ENV_PATH: ENV_PATH,
  _BACKUP_PATH: BACKUP_PATH,
};
