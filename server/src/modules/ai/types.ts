export const AI_INTENTS = [
  'SUMMARIZE_PROGRESS',
  'IDENTIFY_RISKS',
  'RECOMMEND_PRIORITIES',
  'GENERATE_WEEKLY_UPDATE',
] as const;

export type AiIntent = (typeof AI_INTENTS)[number];
export type AiHistoryMessage = { role: 'USER' | 'ASSISTANT'; content: string };
export type AiRequest = {
  intent?: AiIntent;
  question?: string | null;
  projectId?: string | null;
  history?: AiHistoryMessage[];
};

export type AiEvidence = {
  type: 'TASK' | 'PROJECT' | 'MEMBER' | 'METRIC';
  id: string | null;
  label: string;
  detail: string;
};

export type AiMetadata = {
  provider: 'ANTHROPIC';
  model: string;
  mode: 'LIVE' | 'MOCK';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export type AiResult = {
  summary: string;
  highlights: string[];
  risks: string[];
  recommendedActions: string[];
  evidence: AiEvidence[];
  followUpQuestions: string[];
  generatedAt: string;
  metadata: AiMetadata;
};

export type AiContext = {
  workspace: { id: string; name: string; currentDate: string };
  projects: Array<{
    id: string;
    name: string;
    key: string;
    status: string;
    startDate: Date | null;
    dueDate: Date | null;
    progress: number;
    totalTaskCount: number;
    completedTaskCount: number;
    overdueTaskCount: number;
  }>;
  tasks: Array<{
    id: string;
    projectId: string;
    projectName: string;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    completedAt: Date | null;
    updatedAt: Date;
    assigneeName: string | null;
    labels: string[];
    subtaskProgress: { completed: number; total: number };
  }>;
  team: Array<{
    id: string;
    name: string;
    jobTitle: string | null;
    openTaskCount: number;
    workloadPercent: number;
    urgentTaskCount: number;
    overdueTaskCount: number;
  }>;
  recentActivity: Array<{
    action: string;
    actor: string;
    project: string | null;
    task: string | null;
    timestamp: Date;
  }>;
  metrics: {
    activeProjects: number;
    completedTasks: number;
    openTasks: number;
    overdueTasks: number;
    urgentTasks: number;
    tasksByStatus: Record<string, number>;
    tasksByPriority: Record<string, number>;
    workloadByMember: Array<{ memberId: string; name: string; workloadPercent: number }>;
    projectProgress: Array<{ projectId: string; name: string; progress: number }>;
  };
};
