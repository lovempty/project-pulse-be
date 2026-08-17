import { describe, expect, it } from 'vitest';
import { askAssistant } from '../src/modules/ai/service.js';
import { AppError } from '../src/common/errors/app-error.js';
import type { AiContext } from '../src/modules/ai/types.js';
import { resolveAiMockMode } from '../src/config/env.js';
import { streamAnalysis } from '../src/modules/ai/stream.service.js';

const context: AiContext = {
  workspace: { id: 'workspace-1', name: 'Acme Studio', currentDate: '2026-08-18T00:00:00.000Z' },
  projects: [{ id: 'project-1', name: 'Mobile App', key: 'MAR', status: 'ACTIVE', startDate: null, dueDate: null, progress: 50, totalTaskCount: 2, completedTaskCount: 1, overdueTaskCount: 1 }],
  tasks: [{ id: 'task-1', projectId: 'project-1', projectName: 'Mobile App', title: 'Navigation QA', status: 'IN_PROGRESS', priority: 'URGENT', dueDate: new Date('2020-01-01'), completedAt: null, updatedAt: new Date(), assigneeName: 'Nina', labels: ['Bug'], subtaskProgress: { completed: 1, total: 2 } }],
  team: [{ id: 'member-1', name: 'Nina', jobTitle: 'Designer', openTaskCount: 1, workloadPercent: 40, urgentTaskCount: 1, overdueTaskCount: 1 }],
  recentActivity: [],
  metrics: { activeProjects: 1, completedTasks: 1, openTasks: 1, overdueTasks: 1, urgentTasks: 1, tasksByStatus: { DONE: 1, IN_PROGRESS: 1 }, tasksByPriority: { URGENT: 1, MEDIUM: 1 }, workloadByMember: [{ memberId: 'member-1', name: 'Nina', workloadPercent: 40 }], projectProgress: [{ projectId: 'project-1', name: 'Mobile App', progress: 50 }] },
};

const validOutput = {
  summary: 'One urgent task is overdue.',
  highlights: ['One task is complete.'],
  risks: ['Navigation QA is overdue.'],
  recommendedActions: ['Review Navigation QA today.'],
  evidence: [
    { type: 'TASK', id: 'task-1', label: 'Navigation QA', detail: 'Urgent and overdue.' },
    { type: 'TASK', id: 'invented', label: 'Fake', detail: 'Invalid evidence.' },
    { type: 'METRIC', id: null, label: 'Overdue tasks', detail: '1' },
  ],
  followUpQuestions: ['What blocks Navigation QA?', 'Who can help Nina?'],
};

const clientWith = (value: unknown) => ({ messages: { create: async () => value } }) as any;

describe('Claude AI service', () => {
  it('uses a development fallback but refuses an implicit production mock', () => {
    expect(resolveAiMockMode('development', 'false', undefined)).toBe(true);
    expect(resolveAiMockMode('production', 'true', undefined)).toBe(true);
    expect(() => resolveAiMockMode('production', 'false', undefined)).toThrow('ANTHROPIC_API_KEY is required');
    expect(resolveAiMockMode('production', 'false', 'live-key')).toBe(false);
  });

  it('returns deterministic mock data with the live response shape', async () => {
    const result = await askAssistant({ intent: 'IDENTIFY_RISKS' }, context);
    expect(result.metadata).toMatchObject({ provider: 'ANTHROPIC', mode: 'MOCK', inputTokens: 0, outputTokens: 0 });
    expect(result.evidence[0]?.id).toBe('task-1');
  });

  it('parses structured Claude output and removes invented evidence IDs', async () => {
    const result = await askAssistant(
      { question: 'What is at risk?' },
      context,
      { forceLive: true, client: clientWith({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(validOutput) }], usage: { input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 20 } }) },
    );
    expect(result.metadata).toMatchObject({ provider: 'ANTHROPIC', mode: 'LIVE', inputTokens: 120, outputTokens: 80, cacheReadTokens: 20 });
    expect(result.evidence.map((evidence) => evidence.id)).toEqual(['task-1', null]);
  });

  it('maps invalid JSON and truncated output to a controlled error', async () => {
    await expect(askAssistant({ intent: 'SUMMARIZE_PROGRESS' }, context, { forceLive: true, client: clientWith({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{bad' }], usage: {} }) })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', statusCode: 502 });
    await expect(askAssistant({ intent: 'SUMMARIZE_PROGRESS' }, context, { forceLive: true, client: clientWith({ stop_reason: 'max_tokens', content: [], usage: {} }) })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', statusCode: 502 });
  });

  it('maps upstream rate limits without leaking the upstream error', async () => {
    const client = { messages: { create: async () => { throw Object.assign(new Error('secret upstream response'), { status: 429 }); } } } as any;
    try {
      await askAssistant({ intent: 'RECOMMEND_PRIORITIES' }, context, { forceLive: true, client });
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'AI_RATE_LIMITED', statusCode: 429, details: null });
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('maps SDK timeouts to a safe gateway timeout', async () => {
    const client = { messages: { create: async () => { throw Object.assign(new Error('request timed out'), { name: 'APIConnectionTimeoutError' }); } } } as any;
    await expect(askAssistant({ intent: 'SUMMARIZE_PROGRESS' }, context, { forceLive: true, client })).rejects.toMatchObject({ code: 'AI_TIMEOUT', statusCode: 504, details: null });
  });

  it('streams only decoded summary text and validates the final structured result', async () => {
    const json = JSON.stringify(validOutput);
    const pieces = [json.slice(0, 13), json.slice(13, 28), json.slice(28, 53), json.slice(53)];
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        for (const text of pieces) yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
      },
      async finalMessage() { return { stop_reason: 'end_turn', usage: { input_tokens: 90, output_tokens: 45, cache_read_input_tokens: 3 } }; },
    };
    let receivedSignal: AbortSignal | undefined;
    const client = { messages: { stream: (_body: unknown, options: { signal: AbortSignal }) => { receivedSignal = options.signal; return fakeStream; } } } as any;
    const deltas: string[] = [];
    const result = await streamAnalysis({ question: 'What is at risk?' }, context, { forceLive: true, client, signal: new AbortController().signal, onDelta: async (text) => { deltas.push(text); } });
    expect(deltas.join('')).toBe(validOutput.summary);
    expect(deltas.join('')).not.toContain('{"summary"');
    expect(result.responseSource).toBe('CLAUDE');
    expect(result.evidence.map((evidence) => evidence.id)).toEqual(['task-1', null]);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it('stops mock streaming immediately when the client signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Client disconnected'));
    await expect(streamAnalysis({ intent: 'IDENTIFY_RISKS' }, context, { signal: controller.signal, onDelta: async () => undefined })).rejects.toThrow('Client disconnected');
  });
});
