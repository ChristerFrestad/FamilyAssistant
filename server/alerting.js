// Alert-webhook (M4.3)
//
// Sender varsler til en HTTP-webhook når ting går galt:
//   - uncaughtException / unhandledRejection
//   - backup feilet
//   - circuit breaker åpnet mot kritisk backend
//   - /ready returnerer 503 i > 5 minutter sammenhengende
//
// Format er generisk JSON — kompatibel med Discord/Slack/ntfy/custom.
// Webhook settes via ALERT_WEBHOOK env. Hvis ikke satt er alle funksjoner
// no-ops.
//
// Throttling: samme "key" sender maks 1 alert per 15 min for å unngå
// storm ved flapping. Nøkler som er forskjellige telles hver for seg.
//
// Null avhengigheter — ren node:http(s).

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { logger } = require('./logger');

const WEBHOOK_URL = process.env.ALERT_WEBHOOK || '';
const THROTTLE_MS = Number(process.env.ALERT_THROTTLE_MS || 15 * 60 * 1000);
const TIMEOUT_MS = 5000;
const MAX_PAYLOAD_BYTES = 4000;

const lastSent = new Map(); // key → timestamp

function isActive() {
  return Boolean(WEBHOOK_URL);
}

function shouldThrottle(key) {
  const now = Date.now();
  const last = lastSent.get(key);
  if (last && now - last < THROTTLE_MS) return true;
  lastSent.set(key, now);
  // Rydd gamle nøkler
  if (lastSent.size > 100) {
    const cutoff = now - THROTTLE_MS * 2;
    for (const [k, t] of lastSent.entries()) {
      if (t < cutoff) lastSent.delete(k);
    }
  }
  return false;
}

/**
 * Send et alert. Returnerer Promise som resolver uansett — aldri kaster.
 *
 * @param {Object} opts
 * @param {string} opts.level - 'warning' | 'critical' | 'fatal'
 * @param {string} opts.title - kort tittel
 * @param {string} [opts.detail] - lengre beskrivelse
 * @param {Object} [opts.context] - ekstra metadata (JSON-serialiserbart)
 * @param {string} [opts.key] - throttle-nøkkel (default = level+title)
 */
async function send({ level = 'warning', title, detail = '', context = {}, key = null } = {}) {
  if (!WEBHOOK_URL || !title) return { sent: false, reason: 'disabled_or_no_title' };

  const throttleKey = key || `${level}:${title}`;
  if (shouldThrottle(throttleKey)) {
    logger.debug({ key: throttleKey }, 'alert throttled');
    return { sent: false, reason: 'throttled' };
  }

  // Truncate context — trim string-verdier så hele payload-en holder seg
  // under MAX_PAYLOAD_BYTES. Hvis context ikke kan serialiseres, dropper vi
  // det og legger en liten markør i stedet.
  let safeContext = {};
  try {
    const raw = JSON.stringify(context);
    if (raw.length <= MAX_PAYLOAD_BYTES) {
      safeContext = context;
    } else {
      // Trim hver strengverdi til noe håndterbart
      safeContext = {};
      for (const [k, v] of Object.entries(context || {})) {
        if (typeof v === 'string') {
          safeContext[k] = v.length > 500 ? v.slice(0, 500) + '…[truncated]' : v;
        } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
          safeContext[k] = v;
        } else {
          try {
            const s = JSON.stringify(v);
            safeContext[k] = s.length > 500 ? s.slice(0, 500) + '…[truncated]' : v;
          } catch {
            safeContext[k] = '[unserializable]';
          }
        }
      }
      // Hvis det fortsatt er for stort, dropp alt
      if (JSON.stringify(safeContext).length > MAX_PAYLOAD_BYTES) {
        safeContext = { _note: 'context_too_large_dropped' };
      }
    }
  } catch {
    safeContext = { _note: 'context_serialization_failed' };
  }

  const payload = JSON.stringify({
    service: 'familieassistenten',
    level,
    title: String(title).slice(0, 200),
    detail: String(detail).slice(0, 1000),
    context: safeContext,
    hostname: require('os').hostname(),
    timestamp: new Date().toISOString(),
  });

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(WEBHOOK_URL);
    } catch {
      logger.warn({ WEBHOOK_URL }, 'alert: ugyldig ALERT_WEBHOOK URL');
      resolve({ sent: false, reason: 'bad_url' });
      return;
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'familieassistenten-alerting',
      },
      timeout: TIMEOUT_MS,
    };

    const req = lib.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          logger.info({ level, title, status: res.statusCode }, 'alert sendt');
          resolve({ sent: true, status: res.statusCode });
        } else {
          logger.warn({ level, title, status: res.statusCode }, 'alert: webhook svarte med feil');
          resolve({ sent: false, reason: `status_${res.statusCode}` });
        }
      });
    });

    req.on('error', (err) => {
      logger.warn({ err: err.message, title }, 'alert: nettverksfeil');
      resolve({ sent: false, reason: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ sent: false, reason: 'timeout' });
    });

    req.write(payload);
    req.end();
  });
}

// Convenience wrappers
function warning(title, opts = {}) {
  return send({ ...opts, level: 'warning', title });
}
function critical(title, opts = {}) {
  return send({ ...opts, level: 'critical', title });
}
function fatal(title, opts = {}) {
  return send({ ...opts, level: 'fatal', title });
}

// Test-helper: reset throttle og (optional) inject webhook URL
function _resetThrottle() {
  lastSent.clear();
}

module.exports = {
  isActive,
  send,
  warning,
  critical,
  fatal,
  _resetThrottle,
};
