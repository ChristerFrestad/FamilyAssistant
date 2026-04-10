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
    paths: ['password', 'token', 'authorization', 'cookie', '*.password', '*.token'],
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
