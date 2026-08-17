import { env } from '../../config/env.js';
import type { AiContext, AiResult } from './types.js';

export function createMockResult(context: AiContext): AiResult {
  const overdue = context.tasks.filter((task) => task.status !== 'DONE' && task.dueDate && task.dueDate < new Date());
  const urgent = context.tasks.filter((task) => task.status !== 'DONE' && task.priority === 'URGENT');
  const firstRisk = overdue[0] ?? urgent[0];
  return {
    summary: `${context.workspace.name} has ${context.metrics.completedTasks} completed tasks and ${context.metrics.openTasks} open tasks in scope.`,
    highlights: context.metrics.completedTasks ? [`${context.metrics.completedTasks} tasks are complete.`] : ['Delivery work is currently in progress.'],
    risks: overdue.length ? [`${overdue.length} overdue tasks in the analyzed context require attention.`] : ['No overdue tasks were detected in the analyzed context.'],
    recommendedActions: firstRisk ? [`Review “${firstRisk.title}” with its owner and confirm the next delivery action.`] : ['Confirm the next highest-priority deliverables.'],
    evidence: firstRisk ? [{ type: 'TASK', id: firstRisk.id, label: firstRisk.title, detail: firstRisk.dueDate && firstRisk.dueDate < new Date() ? 'Task is overdue.' : 'Task is urgent and open.' }] : [{ type: 'METRIC', id: null, label: 'Open tasks', detail: String(context.metrics.openTasks) }],
    followUpQuestions: ['Which open task has the greatest delivery impact?', 'How should the current workload be rebalanced?'],
    generatedAt: new Date().toISOString(),
    metadata: { provider: 'ANTHROPIC', model: env.anthropicModel, mode: 'MOCK', latencyMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  };
}
