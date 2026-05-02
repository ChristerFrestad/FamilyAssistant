// Alert webhook (M4.3)
//
// Sends alerts to an HTTP webhook when things go wrong:
//   - uncaughtException / unhandledRejection
//   - backup failed
//   - circuit breaker opened against critical backend
//   - /ready returns 503 for more than 5 continuous minutes
//
// Format is generic JSON — compatible with Discord/Slack/ntfy/custom.
// Webhook is set via the ALERT_WEBHOOK env. When not set, all functions
// are no-ops.
//
// Throttling: the same "key" sends at most 1 alert per 15 min to avoid
// a storm during flapping. Different keys are counted separately.
//
// Zero dependencies — plain node:http(s).

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
  // Drop old keys
  if (lastSent.size > 100) {
    const cutoff = now - THROTTLE_MS * 2;
    for (const [k, t] of lastSent.entries()) {
      if (t < cutoff) lastSent.delete(k);
    }
  }
  return false;
}

/**
 * Send an alert. Returns a Promise that resolves regardless — never throws.
 *
 * @param {Object} opts
 * @param {string} opts.level - 'warning' | 'critical' | 'fatal'
 * @param {string} opts.title - short title
 * @param {string} [opts.detail] - longer description
 * @param {Object} [opts.context] - extra metadata (JSON-serialisable)
 * @param {string} [opts.key] - throttle key (default = level+title)
 */
async function send({ level = 'warning', title, detail = '', context = {}, key = null } = {}) {
  if (!WEBHOOK_URL || !title) return { sent: false, reason: 'disabled_or_no_title' };

  const throttleKey = key || `${level}:${title}`;
  if (shouldThrottle(throttleKey)) {
    logger.debug({ key: throttleKey }, 'alert throttled');
    return { sent: false, reason: 'throttled' };
  }

  // Truncate context — trim string values so the full payload stays
  // below MAX_PAYLOAD_BYTES. If context cannot be serialised we drop
  // it and replace it with a small marker.
  let safeContext;
  try {
    const raw = JSON.stringify(context);
    if (raw.length <= MAX_PAYLOAD_BYTES) {
      safeContext = context;
    } else {
      // Trim each string value to something manageable
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
      // If it's still too large, drop everything
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
      logger.warn({ WEBHOOK_URL }, 'alert: invalid ALERT_WEBHOOK URL');
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
          logger.info({ level, title, status: res.statusCode }, 'alert sent');
          resolve({ sent: true, status: res.statusCode });
        } else {
          logger.warn({ level, title, status: res.statusCode }, 'alert: webhook returned an error');
          resolve({ sent: false, reason: `status_${res.statusCode}` });
        }
      });
    });

    req.on('error', (err) => {
      logger.warn({ err: err.message, title }, 'alert: network error');
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

// Test helper: reset throttle and (optional) inject webhook URL
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
