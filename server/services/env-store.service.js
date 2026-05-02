/**
 * Phase F6 — .env writing with three-layer defense.
 *
 * Security:
 *   1. WHITELIST — only 6 known keys may be written
 *   2. FORMAT VALIDATOR — each key has its own regex for format
 *   3. SANITIZE — reject newlines, null-bytes, control chars, shell
 *                  meta-chars in sensitive positions, max 500 chars
 *   4. FILE LOCK — simplified process-local mutex (single-instance server)
 *   5. ATOMIC WRITE — write to .env.tmp → rename
 *   6. BACKUP — copy to .env.bak before each write
 *
 * Config reload:
 *   Hybrid — inline for keys read per-request, restart-required for keys
 *   bound at module init (OLLAMA_URL).
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

// Which keys can be reloaded inline without a server restart
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
  OLLAMA_URL: /^https?:\/\/[a-zA-Z0-9.:/_-]{3,200}$/,
  LLM_BACKEND: /^(anthropic|openai|xai|ollama|none|disabled)$/,
};

// Process-local mutex for concurrent-write protection
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
    throw new Error('Value must be a string');
  }
  if (value.length === 0) {
    throw new Error('Value cannot be empty');
  }
  if (value.length > 500) {
    throw new Error('Value is too long (max 500 chars)');
  }
  if (FORBIDDEN_CHARS.test(value)) {
    throw new Error('Value contains invalid characters (newlines, null-bytes or control chars)');
  }
  // Disallow double-quote in value — would break quoting
  if (value.includes('"')) {
    throw new Error('Value cannot contain double-quote characters');
  }
  return value;
}

// ============================================================
// Masking for read
// ============================================================

function mask(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 6) return '●'.repeat(value.length);
  const visible = value.slice(-4);
  return '●'.repeat(Math.min(10, value.length - 4)) + '•' + visible;
}

// ============================================================
// Read (masked)
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
  let content;
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    // File does not exist → return null for all whitelisted
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
    throw new Error(`Unknown key '${key}'. Allowed: ${WHITELIST.join(', ')}`);
  }
  const clean = sanitize(value);
  const validator = FORMAT_VALIDATORS[key];
  if (validator && !validator.test(clean)) {
    throw new Error(`Invalid format for ${key}`);
  }

  await acquireLock();
  try {
    // Backup
    if (fs.existsSync(ENV_PATH)) {
      try {
        fs.copyFileSync(ENV_PATH, BACKUP_PATH);
      } catch {
        // Not fatal — continue
      }
    }

    // Read existing content
    let content = '';
    try {
      content = fs.readFileSync(ENV_PATH, 'utf8');
    } catch {
      /* empty file */
    }

    const lines = content ? content.split(/\r?\n/) : [];
    const newLine = `${key}="${clean}"`;
    const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (idx >= 0) {
      lines[idx] = newLine;
    } else {
      // If the last line is empty, replace it; otherwise append
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines[lines.length - 1] = newLine;
        lines.push('');
      } else {
        lines.push(newLine);
      }
    }

    // Atomic write: write to tmp, then rename
    const newContent = lines.join('\n');
    fs.writeFileSync(TMP_PATH, newContent, { mode: 0o600 });
    fs.renameSync(TMP_PATH, ENV_PATH);

    // Inline update of process.env if reloadable
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
    // Clean up tmp if it still exists (should not happen after rename)
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
 * Runs a live health-check against the given integration.
 * Returns {ok, latencyMs, error}.
 */
async function testIntegration(name) {
  const start = Date.now();
  try {
    switch (name) {
      case 'kassal': {
        const key = process.env.KASSAL_API_KEY;
        if (!key) return { ok: false, error: 'No API key set' };
        // Lightweight check: HEAD/GET against a Kassal endpoint
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
        if (!key) return { ok: false, error: 'No API key set' };
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
        if (!key) return { ok: false, error: 'No API key set' };
        // Anthropic requires POST for chat, but we can use a minimal probe
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
        if (!key) return { ok: false, error: 'No API key set' };
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
        return { ok: false, error: `Unknown integration: ${name}` };
    }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message || 'Unknown error' };
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
