import { Type } from '@sinclair/typebox';
import { AI_INTENTS } from './types.js';

export const aiRequestSchema = Type.Object(
  {
    intent: Type.Optional(Type.Union(AI_INTENTS.map((intent) => Type.Literal(intent)))),
    question: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 1000 }), Type.Null()])),
    projectId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    history: Type.Optional(
      Type.Array(
        Type.Object(
          {
            role: Type.Union([Type.Literal('USER'), Type.Literal('ASSISTANT')]),
            content: Type.String({ minLength: 1, maxLength: 2000 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 6 },
      ),
    ),
  },
  { additionalProperties: false },
);

export const aiOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Concise executive summary.' },
    highlights: { type: 'array', items: { type: 'string' }, description: 'Important factual progress highlights.' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Specific delivery risks supported by the context.' },
    recommendedActions: { type: 'array', items: { type: 'string' }, description: 'Concrete actions tied to supplied entities.' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['TASK', 'PROJECT', 'MEMBER', 'METRIC'] },
          id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          label: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['type', 'id', 'label', 'detail'],
      },
    },
    followUpQuestions: { type: 'array', items: { type: 'string' }, description: 'Two to five useful follow-up questions.' },
  },
  required: ['summary', 'highlights', 'risks', 'recommendedActions', 'evidence', 'followUpQuestions'],
} as const;

export const aiResponseDataSchema = Type.Object({
  responseType: Type.Union([Type.Literal('CONVERSATIONAL'), Type.Literal('ANALYSIS')]),
  responseSource: Type.Union([Type.Literal('SYSTEM'), Type.Literal('CLAUDE')]),
  summary: Type.String(),
  highlights: Type.Array(Type.String()),
  risks: Type.Array(Type.String()),
  recommendedActions: Type.Array(Type.String()),
  evidence: Type.Array(
    Type.Object({
      type: Type.Union(['TASK', 'PROJECT', 'MEMBER', 'METRIC'].map((value) => Type.Literal(value))),
      id: Type.Union([Type.String(), Type.Null()]),
      label: Type.String(),
      detail: Type.String(),
    }),
  ),
  followUpQuestions: Type.Array(Type.String()),
  generatedAt: Type.String({ format: 'date-time' }),
  metadata: Type.Object({
    provider: Type.Literal('ANTHROPIC'),
    model: Type.String(),
    mode: Type.Union([Type.Literal('LIVE'), Type.Literal('MOCK')]),
    latencyMs: Type.Integer({ minimum: 0 }),
    inputTokens: Type.Integer({ minimum: 0 }),
    outputTokens: Type.Integer({ minimum: 0 }),
    cacheReadTokens: Type.Integer({ minimum: 0 }),
  }),
});

export function isStructuredAiOutput(value: unknown): value is {
  summary: string;
  highlights: string[];
  risks: string[];
  recommendedActions: string[];
  evidence: Array<{ type: 'TASK' | 'PROJECT' | 'MEMBER' | 'METRIC'; id: string | null; label: string; detail: string }>;
  followUpQuestions: string[];
} {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const strings = (key: string) => Array.isArray(item[key]) && (item[key] as unknown[]).every((entry) => typeof entry === 'string');
  if (typeof item.summary !== 'string' || !strings('highlights') || !strings('risks') || !strings('recommendedActions') || !strings('followUpQuestions')) return false;
  if (!Array.isArray(item.evidence)) return false;
  return item.evidence.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const evidence = entry as Record<string, unknown>;
    return ['TASK', 'PROJECT', 'MEMBER', 'METRIC'].includes(String(evidence.type)) && (typeof evidence.id === 'string' || evidence.id === null) && typeof evidence.label === 'string' && typeof evidence.detail === 'string';
  });
}
