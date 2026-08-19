import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/application.js';
import { AppError } from '../src/common/errors/app-error.js';

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
    expect(response.json().data).toMatchObject({ provider: 'ANTHROPIC', model: 'claude-sonnet-5', mode: 'MOCK', supportsCustomQuestions: true, supportsProjectFiltering: true, supportsFollowUps: true, supportsStreaming: true, streamProtocol: 'SSE', streamEndpoint: '/api/v1/workspaces/:workspaceId/ai/stream' });
    expect(response.body).not.toContain('API_KEY');
  });

  it('returns a concise greeting without querying workspace context', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const original = app.requireWorkspace;
    app.requireWorkspace = async () => ({ id: workspaceId, role: 'OWNER' });
    const token = app.jwt.sign({ sub: '00000000-0000-4000-8000-000000000002', email: 'alex@projectpulse.dev', type: 'access' });
    const response = await app.inject({ method: 'POST', url: `/api/v1/workspaces/${workspaceId}/ai/ask`, headers: { authorization: `Bearer ${token}` }, payload: { question: 'Hi' } });
    app.requireWorkspace = original;
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ responseType: 'CONVERSATIONAL', responseSource: 'SYSTEM', summary: 'Hi! What would you like to know about your projects today?', highlights: [], risks: [], recommendedActions: [], evidence: [], metadata: { inputTokens: 0, outputTokens: 0 } });
  });

  it('streams a greeting with the documented SSE headers and event order', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const original = app.requireWorkspace;
    app.requireWorkspace = async () => ({ id: workspaceId, role: 'OWNER' });
    const token = app.jwt.sign({ sub: '00000000-0000-4000-8000-000000000002', email: 'alex@projectpulse.dev', type: 'access' });
    const response = await app.inject({ method: 'POST', url: `/api/v1/workspaces/${workspaceId}/ai/stream`, headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream', origin: 'http://localhost:3000' }, payload: { question: 'Hello!' } });
    app.requireWorkspace = original;
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache, no-transform');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    const events = [...response.body.matchAll(/event: (\w+)\ndata: (.+)\nid: (\d+)\n\n/g)];
    expect(events.map((match) => match[1])).toEqual(['start', 'status', 'delta', 'delta', 'delta', 'result', 'done']);
    expect(events.map((match) => Number(match[3]))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(JSON.parse(events[0]![2]!)).toMatchObject({ responseType: 'CONVERSATIONAL', responseSource: 'SYSTEM', mode: 'MOCK' });
    expect(events.filter((match) => match[1] === 'delta').map((match) => JSON.parse(match[2]!).text).join('')).toBe('Hi! What would you like to know about your projects today?');
  });

  it('returns normal JSON validation errors before opening an SSE stream', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const original = app.requireWorkspace;
    app.requireWorkspace = async () => ({ id: workspaceId, role: 'OWNER' });
    const token = app.jwt.sign({ sub: '00000000-0000-4000-8000-000000000002', email: 'alex@projectpulse.dev', type: 'access' });
    const response = await app.inject({ method: 'POST', url: `/api/v1/workspaces/${workspaceId}/ai/stream`, headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, payload: {} });
    app.requireWorkspace = original;
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json().error.code).toBe('AI_PROMPT_REQUIRED');
  });

  it('emits a safe SSE error after streaming has started', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const originalWorkspace = app.requireWorkspace;
    const originalTransaction = app.prisma.$transaction;
    app.requireWorkspace = async () => ({ id: workspaceId, role: 'OWNER' });
    (app.prisma as any).$transaction = async () => { throw new AppError(504, 'AI_TIMEOUT', 'The project assistant timed out'); };
    const token = app.jwt.sign({ sub: '00000000-0000-4000-8000-000000000002', email: 'alex@projectpulse.dev', type: 'access' });
    const response = await app.inject({ method: 'POST', url: `/api/v1/workspaces/${workspaceId}/ai/stream`, headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, payload: { intent: 'IDENTIFY_RISKS' } });
    app.requireWorkspace = originalWorkspace;
    (app.prisma as any).$transaction = originalTransaction;
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: start');
    expect(response.body).toContain('event: error');
    expect(response.body).toContain('"code":"AI_TIMEOUT"');
    expect(response.body).toContain('"retryable":true');
    expect(response.body).not.toContain('event: done');
  });
});
