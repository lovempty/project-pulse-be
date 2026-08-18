import { Anthropic } from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { createMockResult } from './mock.js';
import { buildUserPrompt, AI_SYSTEM_PROMPT } from './prompts.js';
import { aiOutputJsonSchema } from './schemas.js';
import { IncrementalSummaryExtractor } from './summary-extractor.js';
import { mapClaudeError, parseAiOutput, validateEvidence, type ClaudeClient } from './service.js';
import type { AiContext, AiRequest, AiResult } from './types.js';

type StreamOptions = {
  signal: AbortSignal;
  onDelta: (text: string) => Promise<void>;
  client?: ClaudeClient;
  forceLive?: boolean;
};

export async function streamAnalysis(request: AiRequest, context: AiContext, options: StreamOptions): Promise<AiResult> {
  if (env.aiMock && !options.forceLive) {
    const result = createMockResult(context);
    for (const chunk of result.summary.match(/.{1,28}(?:\s|$)/g) ?? [result.summary]) {
      if (options.signal.aborted) throw options.signal.reason;
      await options.onDelta(chunk);
    }
    return result;
  }
  if (!env.anthropicKey && !options.client) return mapClaudeError({ status: 401 });

  const client = options.client ?? new Anthropic({ apiKey: env.anthropicKey, timeout: env.aiTimeoutMs, maxRetries: 1 });
  const startedAt = Date.now();
  const extractor = new IncrementalSummaryExtractor();
  let rawJson = '';
  try {
    const stream = client.messages.stream(
      {
        model: env.anthropicModel,
        max_tokens: env.aiMaxOutputTokens,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(request, context) }],
        output_config: { format: { type: 'json_schema', schema: aiOutputJsonSchema } },
      },
      { signal: options.signal },
    );
    for await (const event of stream) {
      if (options.signal.aborted) throw options.signal.reason;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawJson += event.delta.text;
        const visible = extractor.push(event.delta.text);
        if (visible) await options.onDelta(visible);
      }
    }
    const response = await stream.finalMessage();
    if (response.stop_reason === 'max_tokens') throw new AppError(502, 'AI_INVALID_RESPONSE', 'The project assistant response was truncated');
    const parsed = parseAiOutput(rawJson);
    return {
      ...parsed,
      responseType: 'ANALYSIS',
      responseSource: 'CLAUDE',
      evidence: validateEvidence(parsed, context),
      generatedAt: new Date().toISOString(),
      metadata: {
        provider: 'ANTHROPIC',
        model: env.anthropicModel,
        mode: 'LIVE',
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  } catch (cause) {
    if (options.signal.aborted) throw cause;
    mapClaudeError(cause);
  }
}
