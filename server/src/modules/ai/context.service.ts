import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import type { AiContext } from './types.js';

const priorityWeight: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const workloadPoints: Record<string, number> = { URGENT: 5, HIGH: 3, MEDIUM: 2, LOW: 1 };
const countOf = (group: { _count?: unknown }) => Number((group._count as { _all?: number } | undefined)?._all ?? 0);

export async function buildAiContext(prisma: PrismaClient, workspaceId: string, projectId?: string | null): Promise<AiContext> {
  const now = new Date();
  const scope = { workspaceId, ...(projectId ? { projectId } : {}), deletedAt: null };
  const [workspace, projects, rawTasks, teamRows, recentActivity, statusGroups, priorityGroups, projectGroups, overdueGroups] = await prisma.$transaction([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { id: true, name: true } }),
    prisma.project.findMany({
      where: { workspaceId, ...(projectId ? { id: projectId } : {}), archivedAt: null },
      select: { id: true, name: true, key: true, status: true, startDate: true, dueDate: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.task.findMany({
      where: scope,
      select: {
        id: true,
        projectId: true,
        project: { select: { name: true } },
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        completedAt: true,
        updatedAt: true,
        assignee: { select: { name: true } },
        labels: { select: { label: { select: { name: true } } } },
        subtasks: { where: { deletedAt: null }, select: { status: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(env.aiMaxContextTasks * 3, env.aiMaxContextTasks),
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        user: {
          select: {
            id: true,
            name: true,
            jobTitle: true,
            assignedTasks: {
              where: { ...scope, status: { not: 'DONE' } },
              select: { priority: true, dueDate: true },
            },
          },
        },
      },
    }),
    prisma.activity.findMany({
      where: { workspaceId, ...(projectId ? { projectId } : {}) },
      select: {
        action: true,
        createdAt: true,
        actor: { select: { name: true } },
        project: { select: { name: true } },
        task: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.task.groupBy({ by: ['status'], where: scope, _count: { _all: true }, orderBy: { status: 'asc' } }),
    prisma.task.groupBy({ by: ['priority'], where: scope, _count: { _all: true }, orderBy: { priority: 'asc' } }),
    prisma.task.groupBy({ by: ['projectId', 'status'], where: scope, _count: { _all: true }, orderBy: [{ projectId: 'asc' }, { status: 'asc' }] }),
    prisma.task.groupBy({ by: ['projectId'], where: { ...scope, status: { not: 'DONE' }, dueDate: { lt: now } }, _count: { _all: true }, orderBy: { projectId: 'asc' } }),
  ]);

  const rankedTasks = [...rawTasks]
    .sort((a, b) => {
      const score = (task: typeof a) => {
        const open = task.status !== 'DONE' ? 100 : 0;
        const overdue = task.dueDate && task.dueDate < now && task.status !== 'DONE' ? 1000 : 0;
        const recentDone = task.completedAt && now.getTime() - task.completedAt.getTime() < 14 * 86_400_000 ? 150 : 0;
        return overdue + open + recentDone + (priorityWeight[task.priority] ?? 0) * 20 + task.updatedAt.getTime() / 1e12;
      };
      return score(b) - score(a);
    })
    .slice(0, env.aiMaxContextTasks);

  const taskCounts = new Map<string, { total: number; completed: number; overdue: number }>();
  for (const group of projectGroups) {
    const current = taskCounts.get(group.projectId) ?? { total: 0, completed: 0, overdue: 0 };
    current.total += countOf(group);
    if (group.status === 'DONE') current.completed += countOf(group);
    taskCounts.set(group.projectId, current);
  }
  for (const group of overdueGroups) {
    const current = taskCounts.get(group.projectId);
    if (current) current.overdue = countOf(group);
  }

  const team = teamRows.map(({ user }) => {
    const points = user.assignedTasks.reduce((total, task) => total + (workloadPoints[task.priority] ?? 0), 0);
    return {
      id: user.id,
      name: user.name,
      jobTitle: user.jobTitle,
      openTaskCount: user.assignedTasks.length,
      workloadPercent: Math.min(100, Math.round((points / 20) * 100)),
      urgentTaskCount: user.assignedTasks.filter((task) => task.priority === 'URGENT').length,
      overdueTaskCount: user.assignedTasks.filter((task) => task.dueDate && task.dueDate < now).length,
    };
  });

  const projectContext = projects.map((project) => {
    const counts = taskCounts.get(project.id) ?? { total: 0, completed: 0, overdue: 0 };
    return {
      ...project,
      progress: counts.total ? Math.round((counts.completed / counts.total) * 100) : 0,
      totalTaskCount: counts.total,
      completedTaskCount: counts.completed,
      overdueTaskCount: counts.overdue,
    };
  });
  const tasksByStatus = Object.fromEntries(statusGroups.map((group) => [group.status, countOf(group)]));
  const tasksByPriority = Object.fromEntries(priorityGroups.map((group) => [group.priority, countOf(group)]));
  const completedTasks = tasksByStatus.DONE ?? 0;
  const totalTasks = Object.values(tasksByStatus).reduce((sum, count) => sum + count, 0);

  return {
    workspace: { ...workspace, currentDate: now.toISOString() },
    projects: projectContext,
    tasks: rankedTasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      projectName: task.project.name,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      completedAt: task.completedAt,
      updatedAt: task.updatedAt,
      assigneeName: task.assignee?.name ?? null,
      labels: task.labels.map(({ label }) => label.name),
      subtaskProgress: { completed: task.subtasks.filter((subtask) => subtask.status === 'DONE').length, total: task.subtasks.length },
    })),
    team,
    recentActivity: recentActivity.map((activity) => ({
      action: activity.action,
      actor: activity.actor.name,
      project: activity.project?.name ?? null,
      task: activity.task?.title ?? null,
      timestamp: activity.createdAt,
    })),
    metrics: {
      activeProjects: projectContext.filter((project) => project.status === 'ACTIVE').length,
      completedTasks,
      openTasks: totalTasks - completedTasks,
      overdueTasks: projectContext.reduce((sum, project) => sum + project.overdueTaskCount, 0),
      urgentTasks: tasksByPriority.URGENT ?? 0,
      tasksByStatus,
      tasksByPriority,
      workloadByMember: team.map((member) => ({ memberId: member.id, name: member.name, workloadPercent: member.workloadPercent })),
      projectProgress: projectContext.map((project) => ({ projectId: project.id, name: project.name, progress: project.progress })),
    },
  };
}
