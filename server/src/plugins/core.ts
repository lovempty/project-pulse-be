import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { Prisma, PrismaClient, type WorkspaceRole } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import { AppError, forbidden } from '../common/errors/app-error.js';
import { LocalStorageAdapter } from '../modules/attachments/storage.js';

export default fp(async (app) => {
  const prisma = new PrismaClient();
  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => prisma.$disconnect());
  await app.register(cors, { origin: env.corsOrigins, credentials: true });
  await app.register(helmet, { contentSecurityPolicy: env.nodeEnv === 'development' ? false : undefined });
  await app.register(cookie);
  await app.register(jwt, { secret: env.accessSecret });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: env.maxUploadSize, files: 1 } });
  const uploadRoot = resolve(env.uploadDir);
  await mkdir(uploadRoot, { recursive: true });
  app.decorate('storage', new LocalStorageAdapter(uploadRoot));
  await app.register(staticFiles, { root: uploadRoot, prefix: '/uploads/' });
  await app.register(swagger, {
    openapi: {
      info: { title: 'ProjectPulse API', version: '1.0.0', description: 'Project management API' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      tags: ['System', 'Auth', 'Workspaces', 'Members', 'Projects', 'Tasks', 'Comments', 'Attachments', 'Dashboard', 'Activities', 'AI'].map((name) => ({ name }))
    }
  });
  if (env.nodeEnv !== 'production') await app.register(swaggerUi, { routePrefix: '/docs' });

  app.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify();
      const token = request.user;
      if (token.type !== 'access') throw new Error('wrong token type');
      if (!token.email) throw new Error('missing email');
      request.authUser = { id: token.sub, email: token.email };
    } catch { throw new AppError(401, 'UNAUTHORIZED', 'Authentication required'); }
  });
  app.decorate('requireWorkspace', async (request, roles?: WorkspaceRole[]) => {
    const workspaceId = (request.params as { workspaceId?: string }).workspaceId;
    if (!workspaceId) throw new AppError(400, 'WORKSPACE_REQUIRED', 'Workspace is required');
    const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: request.authUser.id } } });
    if (!membership) throw forbidden('You do not have access to this workspace');
    if (roles && !roles.includes(membership.role)) throw forbidden();
    return { id: workspaceId, role: membership.role };
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found', details: null, requestId: request.id } }));
  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as Error & { validation?: unknown; statusCode?: number };
    request.log.error({ err: error }, 'request failed');
    let status = 500, code = 'INTERNAL_ERROR', message = 'An unexpected error occurred', details: unknown = null;
    if (error instanceof AppError) ({ statusCode: status, code, message, details } = error);
    else if ('validation' in error && error.validation) { status = 400; code = 'VALIDATION_ERROR'; message = 'Request validation failed'; details = error.validation; }
    else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') { status = 409; code = 'CONFLICT'; message = 'A record with that value already exists'; }
    else if ((error as { statusCode?: number }).statusCode === 413) { status = 413; code = 'FILE_TOO_LARGE'; message = 'Uploaded file is too large'; }
    reply.code(status).send({ error: { code, message, details, requestId: request.id } });
  });
});
