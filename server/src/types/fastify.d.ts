import type { PrismaClient, WorkspaceRole } from '@prisma/client';
import type { StorageAdapter } from '../modules/attachments/storage.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    storage: StorageAdapter;
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireWorkspace: (request: FastifyRequest, roles?: WorkspaceRole[]) => Promise<{ id: string; role: WorkspaceRole }>;
  }
  interface FastifyRequest { authUser: { id: string; email: string } }
}
declare module '@fastify/jwt' { interface FastifyJWT { payload: { sub: string; email?: string; sid?: string; type: 'access' | 'refresh' }; user: { sub: string; email?: string; sid?: string; type: 'access' | 'refresh' } } }
