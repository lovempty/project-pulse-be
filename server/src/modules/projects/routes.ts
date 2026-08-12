import type { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ProjectStatus } from '@prisma/client';
import { data, ensureWorkspaceUser, pageOf, paginated, parseDate, projectInWorkspace, sendNoContent } from '../../common/http.js';
import { conflict } from '../../common/errors/app-error.js';

const params = Type.Object({ workspaceId: Type.String({ format: 'uuid' }), projectId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
const createBody = Type.Object({ name: Type.String({ minLength: 2, maxLength: 120 }), key: Type.String({ pattern: '^[A-Za-z][A-Za-z0-9]{1,9}$' }), description: Type.Optional(Type.String({ maxLength: 2000 })), color: Type.Optional(Type.String({ maxLength: 20 })), status: Type.Optional(Type.Enum(ProjectStatus)), startDate: Type.Optional(Type.String({ format: 'date-time' })), dueDate: Type.Optional(Type.String({ format: 'date-time' })) }, { additionalProperties: false });

const routes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  const withProgress = async (workspaceId: string, projects: any[]) => {
    const grouped = await app.prisma.task.groupBy({ by: ['projectId', 'status'], where: { workspaceId, deletedAt: null }, _count: true });
    return projects.map((project) => { const counts = grouped.filter((g) => g.projectId === project.id); const total = counts.reduce((s, g) => s + g._count, 0); const done = counts.find((g) => g.status === 'DONE')?._count ?? 0; return { ...project, progress: total ? Math.round(done / total * 100) : 0, taskCount: total }; });
  };
  app.get('/', { schema: { tags: ['Projects'], security: [{ bearerAuth: [] }], querystring: Type.Object({ page: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), search: Type.Optional(Type.String({ maxLength: 100 })), status: Type.Optional(Type.Enum(ProjectStatus)) }, { additionalProperties: false }) } }, async (request) => {
    const { id: workspaceId } = await app.requireWorkspace(request); const query = request.query as any; const { page, limit } = pageOf(query); const where = { workspaceId, archivedAt: null, status: query.status, name: query.search ? { contains: query.search, mode: 'insensitive' as const } : undefined };
    const [items, total] = await app.prisma.$transaction([app.prisma.project.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { updatedAt: 'desc' } }), app.prisma.project.count({ where })]);
    return paginated(request, await withProgress(workspaceId, items), page, limit, total);
  });
  app.post('/', { schema: { tags: ['Projects'], security: [{ bearerAuth: [] }], body: createBody } }, async (request, reply) => {
    const { id: workspaceId } = await app.requireWorkspace(request, ['OWNER', 'ADMIN']); const body = request.body as any; const key = body.key.toUpperCase();
    if (await app.prisma.project.findUnique({ where: { workspaceId_key: { workspaceId, key } } })) throw conflict('PROJECT_KEY_IN_USE', 'Project key already exists in this workspace');
    const project = await app.prisma.project.create({ data: { ...body, key, workspaceId, createdById: request.authUser.id, startDate: parseDate(body.startDate), dueDate: parseDate(body.dueDate), members: { create: { userId: request.authUser.id } } } });
    await app.prisma.activity.create({ data: { workspaceId, projectId: project.id, actorId: request.authUser.id, action: 'PROJECT_CREATED', metadata: { name: project.name, key } } }); return reply.code(201).send(data(request, { ...project, progress: 0, taskCount: 0 }));
  });
  app.get('/:projectId', { schema: { tags: ['Projects'], params, security: [{ bearerAuth: [] }] } }, async (request) => { const { id: workspaceId } = await app.requireWorkspace(request); const project = await projectInWorkspace(app.prisma, workspaceId, (request.params as any).projectId); return data(request, (await withProgress(workspaceId, [project]))[0]); });
  app.patch('/:projectId', { schema: { tags: ['Projects'], params, security: [{ bearerAuth: [] }], body: Type.Partial(createBody) } }, async (request) => {
    const { id: workspaceId } = await app.requireWorkspace(request, ['OWNER', 'ADMIN']); const { projectId } = request.params as any; await projectInWorkspace(app.prisma, workspaceId, projectId); const body = request.body as any;
    const project = await app.prisma.project.update({ where: { id: projectId }, data: { ...body, key: body.key?.toUpperCase(), startDate: parseDate(body.startDate), dueDate: parseDate(body.dueDate), archivedAt: body.status === 'ARCHIVED' ? new Date() : undefined } });
    await app.prisma.activity.create({ data: { workspaceId, projectId, actorId: request.authUser.id, action: 'PROJECT_UPDATED', metadata: { fields: Object.keys(body) } } }); return data(request, project);
  });
  app.delete('/:projectId', { schema: { tags: ['Projects'], params, security: [{ bearerAuth: [] }] } }, async (request, reply) => { const { id: workspaceId } = await app.requireWorkspace(request, ['OWNER', 'ADMIN']); const { projectId } = request.params as any; await projectInWorkspace(app.prisma, workspaceId, projectId); await app.prisma.project.update({ where: { id: projectId }, data: { status: 'ARCHIVED', archivedAt: new Date() } }); return sendNoContent(reply); });
  app.get('/:projectId/members', { schema: { tags: ['Projects'], params, security: [{ bearerAuth: [] }] } }, async (request) => { const { id: workspaceId } = await app.requireWorkspace(request); const { projectId } = request.params as any; await projectInWorkspace(app.prisma, workspaceId, projectId); return data(request, await app.prisma.projectMember.findMany({ where: { projectId }, include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, jobTitle: true } } } })); });
  app.put('/:projectId/members', { schema: { tags: ['Projects'], params, security: [{ bearerAuth: [] }], body: Type.Object({ userIds: Type.Array(Type.String({ format: 'uuid' }), { uniqueItems: true, maxItems: 100 }) }, { additionalProperties: false }) } }, async (request) => {
    const { id: workspaceId } = await app.requireWorkspace(request, ['OWNER', 'ADMIN']); const { projectId } = request.params as any; await projectInWorkspace(app.prisma, workspaceId, projectId); const ids = (request.body as any).userIds as string[]; await Promise.all(ids.map((id) => ensureWorkspaceUser(app.prisma, workspaceId, id)));
    await app.prisma.$transaction([app.prisma.projectMember.deleteMany({ where: { projectId } }), app.prisma.projectMember.createMany({ data: ids.map((userId) => ({ projectId, userId })), skipDuplicates: true })]); return data(request, await app.prisma.projectMember.findMany({ where: { projectId }, include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, jobTitle: true } } } }));
  });
};
export default routes;
