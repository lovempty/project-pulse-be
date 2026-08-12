import { createHash, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError, notFound } from './errors/app-error.js';

export const data = (request: FastifyRequest, value: unknown) => ({ data: value, meta: { requestId: request.id } });
export const paginated = (request: FastifyRequest, value: unknown[], page: number, limit: number, total: number) => ({ data: value, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, meta: { requestId: request.id } });
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const slugify = (name: string) => `${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`;
export const parseDate = (value?: string | null) => value ? new Date(value) : value === null ? null : undefined;
export const pageOf = (query: { page?: number; limit?: number }) => ({ page: query.page ?? 1, limit: query.limit ?? 20 });
export const cookieOptions = (secure: boolean) => ({ httpOnly: true, secure, sameSite: 'lax' as const, path: '/api/v1/auth' });
export const sendNoContent = (reply: FastifyReply) => reply.code(204).send();

export async function taskInWorkspace(prisma: PrismaClient, workspaceId: string, taskId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, workspaceId, deletedAt: null } });
  if (!task) throw notFound('Task');
  return task;
}
export async function projectInWorkspace(prisma: PrismaClient, workspaceId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId, archivedAt: null } });
  if (!project) throw notFound('Project');
  return project;
}
export async function ensureWorkspaceUser(prisma: PrismaClient, workspaceId: string, userId: string) {
  if (!await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } })) throw new AppError(400, 'INVALID_WORKSPACE_USER', 'User is not a workspace member');
}
