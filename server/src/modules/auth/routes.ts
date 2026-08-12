import type { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError, conflict } from '../../common/errors/app-error.js';
import { cookieOptions, data, hashToken, normalizeEmail, slugify } from '../../common/http.js';

const credentials = Type.Object({ email: Type.String({ format: 'email', maxLength: 320 }), password: Type.String({ minLength: 8, maxLength: 128 }) }, { additionalProperties: false });
const registerBody = Type.Intersect([credentials, Type.Object({ name: Type.String({ minLength: 2, maxLength: 100 }), workspaceName: Type.Optional(Type.String({ minLength: 2, maxLength: 100 })), jobTitle: Type.Optional(Type.String({ maxLength: 100 })) })], { additionalProperties: false });
const tokenSchema = Type.Object({ accessToken: Type.String(), refreshToken: Type.Optional(Type.String()), user: Type.Any() });

const authRoutes: FastifyPluginAsync = async (app) => {
  const issue = async (user: { id: string; email: string }) => {
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email, type: 'access' }, { expiresIn: env.accessTtl });
    const sessionId = randomUUID();
    const refreshToken = app.jwt.sign({ sub: user.id, sid: sessionId, type: 'refresh' }, { key: env.refreshSecret, expiresIn: env.refreshTtl });
    const decoded = app.jwt.decode(refreshToken) as { exp: number };
    await app.prisma.session.create({ data: { id: sessionId, userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(decoded.exp * 1000) } });
    return { accessToken, refreshToken };
  };
  const publicUser = { id: true, name: true, email: true, avatarUrl: true, jobTitle: true, createdAt: true, updatedAt: true } as const;

  app.post('/register', { schema: { tags: ['Auth'], body: registerBody, response: { 201: Type.Object({ data: tokenSchema, meta: Type.Any() }) } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as any; const email = normalizeEmail(body.email);
    if (await app.prisma.user.findUnique({ where: { email } })) throw conflict('EMAIL_IN_USE', 'An account with that email already exists');
    const passwordHash = await argon2.hash(body.password);
    const user = await app.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name: body.name.trim(), email, passwordHash, jobTitle: body.jobTitle }, select: publicUser });
      const workspace = await tx.workspace.create({ data: { name: body.workspaceName ?? `${body.name.trim()}'s Workspace`, slug: slugify(body.workspaceName ?? body.name), createdById: created.id } });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: created.id, role: 'OWNER' } });
      return created;
    });
    const tokens = await issue(user); reply.setCookie('refreshToken', tokens.refreshToken, cookieOptions(env.cookieSecure));
    return reply.code(201).send(data(request, { accessToken: tokens.accessToken, user }));
  });
  app.post('/login', { schema: { tags: ['Auth'], body: credentials, response: { 200: Type.Object({ data: tokenSchema, meta: Type.Any() }) } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as any; const user = await app.prisma.user.findUnique({ where: { email: normalizeEmail(body.email) } });
    if (!user || !await argon2.verify(user.passwordHash, body.password)) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    const tokens = await issue(user); reply.setCookie('refreshToken', tokens.refreshToken, cookieOptions(env.cookieSecure));
    const safe = { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, jobTitle: user.jobTitle, createdAt: user.createdAt, updatedAt: user.updatedAt }; return data(request, { accessToken: tokens.accessToken, user: safe });
  });
  app.post('/refresh', { schema: { tags: ['Auth'], body: Type.Optional(Type.Object({ refreshToken: Type.Optional(Type.String()) }, { additionalProperties: false })) }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = request.cookies.refreshToken ?? (request.body as any)?.refreshToken;
    if (!token) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    let payload: { sub: string; sid: string; type: string };
    try { payload = app.jwt.verify(token, { key: env.refreshSecret }) as typeof payload; } catch { throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired'); }
    const session = await app.prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (payload.type !== 'refresh' || !session || session.revokedAt || session.expiresAt <= new Date() || session.tokenHash !== hashToken(token)) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    await app.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const tokens = await issue(session.user); reply.setCookie('refreshToken', tokens.refreshToken, cookieOptions(env.cookieSecure));
    return data(request, { accessToken: tokens.accessToken });
  });
  app.post('/logout', { schema: { tags: ['Auth'] } }, async (request, reply) => {
    const token = request.cookies.refreshToken ?? (request.body as any)?.refreshToken;
    if (token) await app.prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
    reply.clearCookie('refreshToken', cookieOptions(env.cookieSecure)); return reply.code(204).send();
  });
  app.get('/me', { preHandler: app.authenticate, schema: { tags: ['Auth'], security: [{ bearerAuth: [] }] } }, async (request) => {
    const user = await app.prisma.user.findUnique({ where: { id: request.authUser.id }, select: publicUser });
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required'); return data(request, user);
  });
  app.patch('/password', { preHandler: app.authenticate, schema: { tags: ['Auth'], security: [{ bearerAuth: [] }], body: Type.Object({ currentPassword: Type.String(), newPassword: Type.String({ minLength: 8, maxLength: 128 }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const body = request.body as any; const user = await app.prisma.user.findUniqueOrThrow({ where: { id: request.authUser.id } });
    if (!await argon2.verify(user.passwordHash, body.currentPassword)) throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    await app.prisma.$transaction([app.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(body.newPassword) } }), app.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })]);
    reply.clearCookie('refreshToken', cookieOptions(env.cookieSecure)); return reply.code(204).send();
  });
};
export default authRoutes;
