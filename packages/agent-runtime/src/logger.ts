import pino from 'pino';

const RUNNER_ID = process.env.RUNNER_ID || 'unknown';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
  base: { runner: RUNNER_ID },
});
