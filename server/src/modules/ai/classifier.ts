import type { AiInteractionType, AiRequest } from './types.js';

const greetings = new Set(['hi', 'hello', 'hey', 'hi there', 'hello there', 'hey there', 'good morning', 'good afternoon', 'good evening']);
const gratitude = new Set(['thanks', 'thank you', 'thanks a lot', 'thank you very much', 'that helps', 'great thanks', 'great thank you']);
const help = new Set(['help', 'what can you do', 'how can you help', 'what can i ask', 'what may i ask']);

export function normalizeConversationalText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyAiRequest(request: AiRequest): AiInteractionType {
  if (!request.question?.trim()) return 'ANALYSIS';
  const normalized = normalizeConversationalText(request.question);
  if (greetings.has(normalized)) return 'GREETING';
  if (gratitude.has(normalized)) return 'GRATITUDE';
  if (help.has(normalized)) return 'HELP';
  return 'ANALYSIS';
}
