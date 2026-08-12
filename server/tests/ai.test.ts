import { describe, expect, it } from 'vitest';
import { askAssistant } from '../src/modules/ai/service.js';

describe('AI mock mode', () => {
  it('is deterministic and returns the production shape', async () => {
    const context = { workspace: 'Acme Studio', projects: [{ name: 'API v2.0' }], tasks: [{ title: 'Finished', status: 'DONE', priority: 'MEDIUM' }, { title: 'Late', status: 'IN_PROGRESS', priority: 'URGENT', dueDate: '2020-01-01T00:00:00.000Z' }] };
    const result = await askAssistant('IDENTIFY_RISKS', context);
    expect(result).toMatchObject({ summary: expect.any(String), highlights: expect.any(Array), risks: expect.any(Array), recommendedActions: expect.any(Array), generatedAt: expect.any(String) });
    expect(result.risks[0]).toContain('overdue');
  });
});
