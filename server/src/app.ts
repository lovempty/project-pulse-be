import Fastify from 'fastify';
import core from './plugins/core.js';
import routes from './routes.js';
import { env } from './config/env.js';

export async function buildApp(options = {}) {
  const logger = env.nodeEnv === 'test' ? false : env.nodeEnv === 'development'
    ? { level: 'debug', transport: { target: 'pino-pretty' } }
    : { level: 'info' };
  const app = Fastify({
    logger,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true, allErrors: true } },
    ...options
  });
  await app.register(core);
  await app.register(routes);
  return app;
}
