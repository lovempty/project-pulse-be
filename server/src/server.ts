import app from './application.js';
import { env } from './config/env.js';

const shutdown = async (signal: string) => { app.log.info({ signal }, 'shutting down'); await app.close(); process.exit(0); };
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
try { await app.listen({ host: env.host, port: env.port }); } catch (error) { app.log.error(error); process.exit(1); }
