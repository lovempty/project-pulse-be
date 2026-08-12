import type { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { WorkspaceRole } from '@prisma/client';
import { data, sendNoContent, slugify } from '../../common/http.js';
import { AppError, conflict, forbidden, notFound } from '../../common/errors/app-error.js';

const wid = Type.Object({ workspaceId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
const mid = Type.Object({ workspaceId: Type.String({ format: 'uuid' }), memberId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
const workspaceBody = Type.Object({ name: Type.String({ minLength: 2, maxLength: 100 }), logoUrl: Type.Optional(Type.Union([Type.String({ format: 'uri' }), Type.Null()])) }, { additionalProperties: false });

const routes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.get('/', { schema: { tags: ['Workspaces'], security: [{ bearerAuth: [] }] } }, async (request) => data(request, await app.prisma.workspace.findMany({ where: { members: { some: { userId: request.authUser.id } } }, include: { _count: { select: { members: true, projects: true } }, members: { where: { userId: request.authUser.id }, select: { role: true } } }, orderBy: { createdAt: 'asc' } })));
  app.post('/', { schema: { tags: ['Workspaces'], security: [{ bearerAuth: [] }], body: workspaceBody } }, async (request, reply) => {
    const body = request.body as any;
    const workspace = await app.prisma.workspace.create({ data: { name: body.name.trim(), logoUrl: body.logoUrl, slug: slugify(body.name), createdById: request.authUser.id, members: { create: { userId: request.authUser.id, role: 'OWNER' } } } });
    return reply.code(201).send(data(request, workspace));
  });
  app.get('/:workspaceId', { schema: { tags: ['Workspaces'], params: wid, security: [{ bearerAuth: [] }] } }, async (request) => { await app.requireWorkspace(request); const workspace = await app.prisma.workspace.findUnique({ where: { id: (request.params as any).workspaceId }, include: { _count: { select: { members: true, projects: true } } } }); if (!workspace) throw notFound('Workspace'); return data(request, workspace); });
  app.patch('/:workspaceId', { schema: { tags: ['Workspaces'], params: wid, body: Type.Partial(workspaceBody), security: [{ bearerAuth: [] }] } }, async (request) => { await app.requireWorkspace(request, ['OWNER', 'ADMIN']); return data(request, await app.prisma.workspace.update({ where: { id: (request.params as any).workspaceId }, data: request.body as any })); });
  app.delete('/:workspaceId', { schema: { tags: ['Workspaces'], params: wid, security: [{ bearerAuth: [] }] } }, async (request, reply) => { await app.requireWorkspace(request, ['OWNER']); await app.prisma.workspace.delete({ where: { id: (request.params as any).workspaceId } }); return sendNoContent(reply); });

  app.get('/:workspaceId/members', { schema: { tags: ['Members'], params: wid, security: [{ bearerAuth: [] }] } }, async (request) => { await app.requireWorkspace(request); return data(request, await app.prisma.workspaceMember.findMany({ where: { workspaceId: (request.params as any).workspaceId }, include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, jobTitle: true } } }, orderBy: { joinedAt: 'asc' } })); });
  app.post('/:workspaceId/members/invite', { schema: { tags: ['Members'], params: wid, security: [{ bearerAuth: [] }], body: Type.Object({ email: Type.String({ format: 'email' }), role: Type.Optional(Type.Enum(WorkspaceRole)) }, { additionalProperties: false }) } }, async (request, reply) => {
    const { id: workspaceId } = await app.requireWorkspace(request, ['OWNER', 'ADMIN']); const body = request.body as any;
    const user = await app.prisma.user.findUnique({ where: { email: body.email.trim().toLowerCase() } });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'No registered user has that email');
    if (body.role === 'OWNER') throw forbidden('Ownership cannot be assigned through an invitation');
    if (await app.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } })) throw conflict('ALREADY_A_MEMBER', 'User is already a workspace member');
    const member = await app.prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role: body.role ?? 'MEMBER' }, include: { user: { select: { id: true, name: true, email: true, jobTitle: true, avatarUrl: true } } } });
    await app.prisma.activity.create({ data: { workspaceId, actorId: request.authUser.id, action: 'MEMBER_JOINED', metadata: { memberId: member.id, userName: user.name } } });
    return reply.code(201).send(data(request, member));
  });
  app.patch('/:workspaceId/members/:memberId', { schema: { tags: ['Members'], params: mid, security: [{ bearerAuth: [] }], body: Type.Object({ role: Type.Enum(WorkspaceRole) }, { additionalProperties: false }) } }, async (request) => {
    const membership = await app.requireWorkspace(request, ['OWNER', 'ADMIN']); const { memberId } = request.params as any; const body = request.body as any;
    const target = await app.prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: membership.id } }); if (!target) throw notFound('Member');
    if (target.role === 'OWNER' || body.role === 'OWNER') throw forbidden('Workspace ownership cannot be changed here');
    if (membership.role === 'ADMIN' && target.role === 'ADMIN') throw forbidden();
    return data(request, await app.prisma.workspaceMember.update({ where: { id: memberId }, data: { role: body.role } }));
  });
  app.delete('/:workspaceId/members/:memberId', { schema: { tags: ['Members'], params: mid, security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const membership = await app.requireWorkspace(request, ['OWNER', 'ADMIN']); const { memberId } = request.params as any;
    const target = await app.prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: membership.id } }); if (!target) throw notFound('Member');
    if (target.role === 'OWNER' || (membership.role === 'ADMIN' && target.role === 'ADMIN')) throw forbidden();
    await app.prisma.workspaceMember.delete({ where: { id: memberId } }); return sendNoContent(reply);
  });
  app.get('/:workspaceId/workload', { schema: { tags: ['Members'], params: wid, security: [{ bearerAuth: [] }] } }, async (request) => {
    const { id: workspaceId } = await app.requireWorkspace(request); const members = await app.prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, avatarUrl: true, assignedTasks: { where: { workspaceId, deletedAt: null, status: { not: 'DONE' } }, select: { priority: true } } } } } });
    return data(request, members.map(({ user }) => { const points = user.assignedTasks.reduce((sum, t) => sum + ({ LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 5 })[t.priority], 0); return { user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl }, openTasks: user.assignedTasks.length, workloadPercent: Math.min(100, Math.round(points / 20 * 100)) }; }));
  });
};
export default routes;
