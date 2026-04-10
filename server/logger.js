// Strukturert logging via pino
// - JSON-linjer i produksjon (maskinlesbart for rsyslog/journald)
// - Pretty-printet i dev
// - Child-loggers med request-ID for sporing gjennom hele request-syklusen

const pino = require('pino');
const { config } = require('./config');

const baseOpts = {
  level: config.LOG_LEVEL,
  base: { pid: process.pid, service: 'familieassistenten' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      // Generiske sensitive felter
      'password', 'token', 'authorization', 'cookie',
      '*.password', '*.token', '*.authorization', '*.cookie',
      // HTTP headers
      'req.headers.authorization', 'req.headers.cookie',
      'headers.authorization', 'headers.cookie',
      'request.headers.authorization', 'request.headers.cookie',
      // API-n\u00f8kler som kan havne i body/query/env-logg
      'KASSAL_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY',
      '*.KASSAL_API_KEY', '*.OPENAI_API_KEY', '*.ANTHROPIC_API_KEY', '*.XAI_API_KEY',
      'body.KASSAL_API_KEY', 'body.OPENAI_API_KEY', 'body.ANTHROPIC_API_KEY', 'body.XAI_API_KEY',
      'body.value', // env-store write bruker { key, value } — value kan v\u00e6re hemmelig
      'body.apiKey', '*.apiKey',
      // AUTH_TOKEN skal aldri logges
      'AUTH_TOKEN', '*.AUTH_TOKEN',
    ],
    censor: '[REDACTED]',
  },
};

let logger;
if (config.LOG_PRETTY) {
  try {
    logger = pino({
      ...baseOpts,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
      },
    });
  } catch {
    logger = pino(baseOpts);
  }
} else {
  logger = pino(baseOpts);
}

// Request-scoped child logger
function childWithRequestId(requestId) {
  return logger.child({ requestId });
}

module.exports = { logger, childWithRequestId };
