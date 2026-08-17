import { env } from '../../config/env.js';
import type { AiInteractionType, AiResult } from './types.js';

const content: Record<Exclude<AiInteractionType, 'ANALYSIS'>, { summary: string; followUpQuestions: string[] }> = {
  GREETING: { summary: 'Hi! What would you like to know about your projects today?', followUpQuestions: [] },
  GRATITUDE: { summary: "You're welcome. Let me know if you want to explore another project question.", followUpQuestions: [] },
  HELP: {
    summary: 'I can summarize progress, identify delivery risks, recommend priorities, analyze workload, and draft stakeholder updates using your ProjectPulse workspace data.',
    followUpQuestions: ['What needs attention today?', "Summarize this week's progress."],
  },
};

export function createConversationalResult(interaction: Exclude<AiInteractionType, 'ANALYSIS'>): AiResult {
  return {
    responseType: 'CONVERSATIONAL',
    responseSource: 'SYSTEM',
    summary: content[interaction].summary,
    highlights: [],
    risks: [],
    recommendedActions: [],
    evidence: [],
    followUpQuestions: content[interaction].followUpQuestions,
    generatedAt: new Date().toISOString(),
    metadata: {
      provider: 'ANTHROPIC',
      model: env.anthropicModel,
      mode: env.aiMock ? 'MOCK' : 'LIVE',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    },
  };
}

export function chunkConversationalSummary(summary: string) {
  const words = summary.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    current += word;
    if (current.length >= 18 && /\s$/.test(current)) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
