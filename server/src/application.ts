import Fastify, { type FastifyInstance } from 'fastify';
import core from './plugins/core.js';
import routes from './routes.js';
import { env } from './config/env.js';

export function createAppOptions(options = {}) {
  const logger = env.nodeEnv === 'test' ? false : env.nodeEnv === 'development'
    ? { level: 'debug', transport: { target: 'pino-pretty' } }
    : { level: 'info' };
  return {
    logger,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true, allErrors: true } },
    ...options
  };
}

export function registerApplication(app: FastifyInstance) {
  app.register(core);
  app.register(routes);
  return app;
}

export function buildApp(options = {}) {
  return registerApplication(Fastify(createAppOptions(options)));
}
