import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { createMockResult } from './mock.js';
import { AI_SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';
import { aiOutputJsonSchema, isStructuredAiOutput } from './schemas.js';
import type { AiContext, AiRequest, AiResult } from './types.js';

type ClaudeClient = Pick<Anthropic, 'messages'>;
type ServiceOptions = { client?: ClaudeClient; forceLive?: boolean };

function parseOutput(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The project assistant returned an invalid response');
  }
  if (!isStructuredAiOutput(parsed) || parsed.followUpQuestions.length < 2 || parsed.followUpQuestions.length > 5) {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The project assistant returned an invalid response');
  }
  return parsed;
}

function validateEvidence(result: ReturnType<typeof parseOutput>, context: AiContext) {
  const validIds = {
    TASK: new Set(context.tasks.map((task) => task.id)),
    PROJECT: new Set(context.projects.map((project) => project.id)),
    MEMBER: new Set(context.team.map((member) => member.id)),
  } as const;
  return result.evidence.filter((evidence) => {
    if (evidence.type === 'METRIC') return evidence.id === null;
    return evidence.id !== null && validIds[evidence.type].has(evidence.id);
  });
}

function mapClaudeError(cause: unknown): never {
  if (cause instanceof AppError) throw cause;
  if (cause instanceof Anthropic.RateLimitError || (cause as { status?: number })?.status === 429) {
    throw new AppError(429, 'AI_RATE_LIMITED', 'The project assistant is busy. Please retry shortly.');
  }
  if (cause instanceof Anthropic.APIConnectionTimeoutError || (cause as { name?: string })?.name === 'APIConnectionTimeoutError') {
    throw new AppError(504, 'AI_TIMEOUT', 'The project assistant timed out');
  }
  if (cause instanceof Anthropic.AuthenticationError || cause instanceof Anthropic.PermissionDeniedError || [401, 403].includes((cause as { status?: number })?.status ?? 0)) {
    throw new AppError(502, 'AI_CONFIGURATION_ERROR', 'The project assistant is not configured correctly');
  }
  throw new AppError(502, 'AI_UPSTREAM_ERROR', 'The project assistant is temporarily unavailable');
}

export async function askAssistant(request: AiRequest, context: AiContext, options: ServiceOptions = {}): Promise<AiResult> {
  if (env.aiMock && !options.forceLive) return createMockResult(context);
  if (!env.anthropicKey && !options.client) throw new AppError(502, 'AI_CONFIGURATION_ERROR', 'The project assistant is not configured correctly');

  const client = options.client ?? new Anthropic({ apiKey: env.anthropicKey, timeout: env.aiTimeoutMs, maxRetries: 1 });
  const startedAt = Date.now();
  try {
    const response = await client.messages.create({
      model: env.anthropicModel,
      max_tokens: env.aiMaxOutputTokens,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(request, context) }],
      output_config: { format: { type: 'json_schema', schema: aiOutputJsonSchema } },
    });
    if ('stop_reason' in response && response.stop_reason === 'max_tokens') throw new AppError(502, 'AI_INVALID_RESPONSE', 'The project assistant response was truncated');
    const text = 'content' in response ? response.content.find((block) => block.type === 'text')?.text : undefined;
    if (!text) throw new AppError(502, 'AI_INVALID_RESPONSE', 'The project assistant returned no usable response');
    const parsed = parseOutput(text);
    const usage = 'usage' in response ? response.usage : undefined;
    return {
      ...parsed,
      evidence: validateEvidence(parsed, context),
      generatedAt: new Date().toISOString(),
      metadata: {
        provider: 'ANTHROPIC',
        model: env.anthropicModel,
        mode: 'LIVE',
        latencyMs: Date.now() - startedAt,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      },
    };
  } catch (cause) {
    mapClaudeError(cause);
  }
}
