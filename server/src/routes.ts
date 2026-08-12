import type { FastifyPluginAsync } from 'fastify';
import auth from './modules/auth/routes.js';
import workspaces from './modules/workspaces/routes.js';
import projects from './modules/projects/routes.js';
import tasks from './modules/tasks/routes.js';
import interactions from './modules/interactions/routes.js';
import insights from './modules/insights/routes.js';
import { data } from './common/http.js';

const routes: FastifyPluginAsync = async (app) => {
  app.get('/health', { schema: { tags: ['System'] } }, async (request) => data(request, { status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/ready', { schema: { tags: ['System'] } }, async (request) => { await app.prisma.$queryRaw`SELECT 1`; return data(request, { status: 'ready', timestamp: new Date().toISOString() }); });
  await app.register(auth, { prefix: '/api/v1/auth' });
  await app.register(workspaces, { prefix: '/api/v1/workspaces' });
  await app.register(projects, { prefix: '/api/v1/workspaces/:workspaceId/projects' });
  await app.register(tasks, { prefix: '/api/v1/workspaces/:workspaceId/tasks' });
  await app.register(interactions, { prefix: '/api/v1/workspaces/:workspaceId' });
  await app.register(insights, { prefix: '/api/v1/workspaces/:workspaceId' });
};
export default routes;
