import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';
import { classifyAiRequest } from './classifier.js';
import { chunkConversationalSummary, createConversationalResult } from './conversation.js';
import { buildAiContext } from './context.service.js';
import { SseWriter } from './sse.js';
import { streamAnalysis } from './stream.service.js';
import type { AiRequest, AiResponseSource } from './types.js';

const retryableCodes = new Set(['AI_RATE_LIMITED', 'AI_TIMEOUT', 'AI_UPSTREAM_ERROR']);

export async function handleAiStream(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  const { id: workspaceId } = await app.requireWorkspace(request);
  const body = request.body as AiRequest;
  if (!body.intent && !body.question?.trim()) throw new AppError(400, 'AI_PROMPT_REQUIRED', 'Provide an intent or question');
  if (body.projectId) {
    const project = await app.prisma.project.findFirst({ where: { id: body.projectId, workspaceId, archivedAt: null }, select: { id: true } });
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  const interactionType = classifyAiRequest(body);
  const conversational = interactionType !== 'ANALYSIS';
  const source: AiResponseSource = conversational || env.aiMock ? 'SYSTEM' : 'CLAUDE';
  const requestOrigin = request.headers.origin;
  const allowedOrigin = requestOrigin && env.corsOrigins.includes(requestOrigin) ? requestOrigin : undefined;
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(allowedOrigin
      ? {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        }
      : {}),
  });
  reply.raw.flushHeaders();

  const writer = new SseWriter(reply.raw);
  const abortController = new AbortController();
  let completed = false;
  const disconnect = () => {
    if (completed || abortController.signal.aborted) return;
    abortController.abort(new Error('Client disconnected'));
    request.log.debug({ workspaceId, projectId: body.projectId ?? null, interactionType }, 'AI stream client disconnected');
  };
  request.raw.once('aborted', disconnect);
  reply.raw.once('close', disconnect);
  request.raw.socket?.once('close', disconnect);
  const heartbeat = setInterval(() => void writer.heartbeat().catch(disconnect), 15_000);

  try {
    await writer.send({
      type: 'start',
      data: { requestId: request.id, responseType: conversational ? 'CONVERSATIONAL' : 'ANALYSIS', responseSource: source, provider: 'ANTHROPIC', model: env.anthropicModel, mode: env.aiMock ? 'MOCK' : 'LIVE' },
    });
    await writer.send({ type: 'status', data: { stage: 'CLASSIFYING', message: 'Understanding your request' } });
    if (conversational) {
      const result = createConversationalResult(interactionType);
      for (const text of chunkConversationalSummary(result.summary)) await writer.send({ type: 'delta', data: { text } });
      await writer.send({ type: 'result', data: result });
      await writer.send({ type: 'done', data: { requestId: request.id } });
      completed = true;
      request.log.info({ workspaceId, projectId: body.projectId ?? null, interactionType, responseSource: 'SYSTEM', model: env.anthropicModel, aiMode: result.metadata.mode, transport: 'SSE', latencyMs: 0, inputTokens: 0, outputTokens: 0 }, 'AI stream completed');
      return;
    }

    await writer.send({ type: 'status', data: { stage: 'GATHERING_CONTEXT', message: 'Reviewing authorized workspace data' } });
    const context = await buildAiContext(app.prisma, workspaceId, body.projectId);
    if (abortController.signal.aborted) return;
    await writer.send({ type: 'status', data: { stage: 'ANALYZING', message: 'Analyzing delivery signals' } });
    const result = await streamAnalysis(body, context, { signal: abortController.signal, onDelta: async (text) => writer.send({ type: 'delta', data: { text } }) });
    if (abortController.signal.aborted) return;
    await writer.send({ type: 'status', data: { stage: 'FORMATTING', message: 'Validating the final response' } });
    await writer.send({ type: 'result', data: result });
    await writer.send({ type: 'done', data: { requestId: request.id } });
    completed = true;
    request.log.info({ workspaceId, projectId: body.projectId ?? null, interactionType, responseSource: result.responseSource, model: result.metadata.model, aiMode: result.metadata.mode, transport: 'SSE', latencyMs: result.metadata.latencyMs, inputTokens: result.metadata.inputTokens, outputTokens: result.metadata.outputTokens }, 'AI stream completed');
  } catch (error) {
    if (abortController.signal.aborted || writer.isClosed()) return;
    const appError = error instanceof AppError ? error : new AppError(502, 'AI_UPSTREAM_ERROR', 'The project assistant is temporarily unavailable');
    request.log.warn({ workspaceId, projectId: body.projectId ?? null, interactionType, responseSource: source, model: env.anthropicModel, aiMode: env.aiMock ? 'MOCK' : 'LIVE', transport: 'SSE', code: appError.code }, 'AI stream failed');
    await writer.send({ type: 'error', data: { code: appError.code, message: appError.message, retryable: retryableCodes.has(appError.code), requestId: request.id } });
  } finally {
    clearInterval(heartbeat);
    completed = true;
    request.raw.off('aborted', disconnect);
    reply.raw.off('close', disconnect);
    request.raw.socket?.off('close', disconnect);
    writer.close();
  }
}
