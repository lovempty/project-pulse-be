import { describe, expect, it } from 'vitest';
import { classifyAiRequest } from '../src/modules/ai/classifier.js';

describe('deterministic AI request classifier', () => {
  it.each([
    ['Hi', 'GREETING'],
    ['Hello!', 'GREETING'],
    ['Good morning', 'GREETING'],
    ['Thanks', 'GRATITUDE'],
    ['What can you do?', 'HELP'],
    ['Hi, which task is at risk?', 'ANALYSIS'],
    ["Hello, summarize this week's progress", 'ANALYSIS'],
    ['Thank you. What should we prioritize?', 'ANALYSIS'],
  ] as const)('classifies %s as %s', (question, expected) => {
    expect(classifyAiRequest({ question })).toBe(expected);
  });

  it('always treats intent-only requests as analysis', () => {
    expect(classifyAiRequest({ intent: 'SUMMARIZE_PROGRESS' })).toBe('ANALYSIS');
  });
});
