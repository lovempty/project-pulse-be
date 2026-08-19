import Fastify from 'fastify';
import { createAppOptions, registerApplication } from './application.js';
import { env } from './config/env.js';

const app = registerApplication(Fastify(createAppOptions()));
const shutdown = async (signal: string) => { app.log.info({ signal }, 'shutting down'); await app.close(); process.exit(0); };
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
void app.listen({ host: env.host, port: env.port }).catch((error) => {
  console.error('Fastify startup failed', error);
  process.exitCode = 1;
});
