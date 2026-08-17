import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('HTTP contract', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('returns a health envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { status: 'ok' }, meta: { requestId: expect.any(String) } });
  });
  it('uses a stable not-found error envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: 'ROUTE_NOT_FOUND', details: null, requestId: expect.any(String) });
  });
  it('rejects malformed registration before database access', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'bad', password: 'short', name: '' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
  it('rejects unauthenticated workspace access', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/workspaces' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('validates custom AI questions and follow-up history limits', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const original = app.requireWorkspace;
    app.requireWorkspace = async () => ({ id: workspaceId, role: 'OWNER' });
    const token = app.jwt.sign({ sub: '00000000-0000-4000-8000-000000000002', email: 'alex@projectpulse.dev', type: 'access' });
    const headers = { authorization: `Bearer ${token}` };
    const emptyQuestion = await app.inject({ method: 'POST', url: `/api/v1/workspaces/${workspaceId}/ai/ask`, headers, payload: { question: '' } });
    expect(emptyQuestion.statusCode).toBe(400);
    const tooMuchHistory = await app.inject({ method: 'POST', url: `/api/v1/workspaces/${workspaceId}/ai/ask`, headers, payload: { intent: 'SUMMARIZE_PROGRESS', history: Array.from({ length: 7 }, () => ({ role: 'USER', content: 'Follow up' })) } });
    expect(tooMuchHistory.statusCode).toBe(400);
    app.requireWorkspace = original;
  });

  it('documents Claude capabilities without exposing configuration secrets', async () => {
    const original = app.requireWorkspace;
    app.requireWorkspace = async () => ({ id: '00000000-0000-4000-8000-000000000001', role: 'OWNER' });
    const token = app.jwt.sign({ sub: '00000000-0000-4000-8000-000000000002', email: 'alex@projectpulse.dev', type: 'access' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/workspaces/00000000-0000-4000-8000-000000000001/ai/capabilities', headers: { authorization: `Bearer ${token}` } });
    app.requireWorkspace = original;
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ provider: 'ANTHROPIC', model: 'claude-sonnet-5', mode: 'MOCK', supportsCustomQuestions: true, supportsProjectFiltering: true, supportsFollowUps: true });
    expect(response.body).not.toContain('API_KEY');
  });
});
