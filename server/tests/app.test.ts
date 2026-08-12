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
});
