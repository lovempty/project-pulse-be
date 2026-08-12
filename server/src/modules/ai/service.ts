import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';

export type AiResult = { summary: string; highlights: string[]; risks: string[]; recommendedActions: string[]; generatedAt: string };
type Context = { workspace: string; projects: unknown[]; tasks: unknown[] };
const systemPrompt = `You are the ProjectPulse project assistant. Use only the supplied structured project data. Be concise and factual. Return JSON with string summary and arrays highlights, risks, recommendedActions. Never invent metrics.`;
const valid = (value: any): value is Omit<AiResult, 'generatedAt'> => value && typeof value.summary === 'string' && ['highlights', 'risks', 'recommendedActions'].every((key) => Array.isArray(value[key]) && value[key].every((v: unknown) => typeof v === 'string'));

export async function askAssistant(intent: string, context: Context): Promise<AiResult> {
  const now = new Date().toISOString();
  if (env.aiMock) {
    const tasks = context.tasks as any[]; const done = tasks.filter((t) => t.status === 'DONE').length; const overdue = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE'); const urgent = tasks.filter((t) => t.priority === 'URGENT' && t.status !== 'DONE');
    return { summary: `${context.workspace} has ${done} completed tasks and ${tasks.length - done} open tasks in the selected period.`, highlights: done ? [`${done} tasks completed`] : ['Work is currently in progress'], risks: overdue.length ? [`${overdue.length} overdue tasks require attention`] : ['No overdue work detected'], recommendedActions: urgent.length ? ['Review urgent tasks with their assignees'] : ['Confirm the next highest-priority deliverables'], generatedAt: now };
  }
  try {
    const client = new OpenAI({ apiKey: env.openAiKey, timeout: env.aiTimeoutMs, maxRetries: 1 });
    const response = await client.responses.create({ model: env.openAiModel, input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify({ intent, context }) }], text: { format: { type: 'json_object' } } });
    const parsed: unknown = JSON.parse(response.output_text); if (!valid(parsed)) throw new Error('invalid model response'); return { ...parsed, generatedAt: now };
  } catch (cause) { throw new AppError(502, 'AI_UPSTREAM_ERROR', 'The project assistant is temporarily unavailable', env.nodeEnv === 'development' ? String(cause) : null); }
}
