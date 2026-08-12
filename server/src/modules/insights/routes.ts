import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  data,
  pageOf,
  paginated,
  projectInWorkspace,
} from "../../common/http.js";
import { askAssistant } from "../ai/service.js";
import { env } from "../../config/env.js";

const wid = Type.Object(
  { workspaceId: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);
const analyticsQuery = Type.Object(
  {
    from: Type.Optional(Type.String({ format: "date-time" })),
    to: Type.Optional(Type.String({ format: "date-time" })),
    projectId: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
);
const aiBody = Type.Object(
  {
    intent: Type.Union([
      Type.Literal("SUMMARIZE_PROGRESS"),
      Type.Literal("IDENTIFY_RISKS"),
      Type.Literal("RECOMMEND_PRIORITIES"),
      Type.Literal("GENERATE_WEEKLY_UPDATE"),
    ]),
    projectId: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
);

const routes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);
  app.get(
    "/dashboard",
    {
      schema: {
        tags: ["Dashboard"],
        params: wid,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { id } = await app.requireWorkspace(request);
      const now = new Date();
      const [
        activeProjects,
        completedTasks,
        overdueTasks,
        projects,
        members,
        activities,
      ] = await app.prisma.$transaction([
        app.prisma.project.count({
          where: { workspaceId: id, status: "ACTIVE", archivedAt: null },
        }),
        app.prisma.task.count({
          where: { workspaceId: id, status: "DONE", deletedAt: null },
        }),
        app.prisma.task.count({
          where: {
            workspaceId: id,
            status: { not: "DONE" },
            dueDate: { lt: now },
            deletedAt: null,
          },
        }),
        app.prisma.project.findMany({
          where: { workspaceId: id, archivedAt: null },
          include: {
            tasks: { where: { deletedAt: null }, select: { status: true } },
          },
          orderBy: { dueDate: "asc" },
          take: 6,
        }),
        app.prisma.workspaceMember.findMany({
          where: { workspaceId: id },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
                assignedTasks: {
                  where: {
                    workspaceId: id,
                    status: { not: "DONE" },
                    deletedAt: null,
                  },
                  select: { priority: true },
                },
              },
            },
          },
        }),
        app.prisma.activity.findMany({
          where: { workspaceId: id },
          include: {
            actor: { select: { id: true, name: true, avatarUrl: true } },
            project: { select: { id: true, name: true } },
            task: { select: { id: true, title: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);
      const summaries = projects.map(({ tasks, ...project }) => ({
        ...project,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t) => t.status === "DONE").length,
        progress: tasks.length
          ? Math.round(
              (tasks.filter((t) => t.status === "DONE").length / tasks.length) *
                100,
            )
          : 0,
      }));
      const workload = members.map(({ user }) => ({
        user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
        openTasks: user.assignedTasks.length,
        workloadPercent: Math.min(
          100,
          user.assignedTasks.reduce(
            (n, t) => n + { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 5 }[t.priority],
            0,
          ) * 5,
        ),
      }));
      return data(request, {
        metrics: {
          activeProjectCount: activeProjects,
          completedTaskCount: completedTasks,
          overdueTaskCount: overdueTasks,
          teamWorkloadPercent: workload.length
            ? Math.round(
                workload.reduce((n, w) => n + w.workloadPercent, 0) /
                  workload.length,
              )
            : 0,
        },
        projectCompletionTrend: summaries.map((p) => ({
          projectId: p.id,
          name: p.name,
          progress: p.progress,
        })),
        activeProjects: summaries,
        teamWorkload: workload,
        recentActivity: activities,
      });
    },
  );
  app.get(
    "/analytics",
    {
      schema: {
        tags: ["Dashboard"],
        params: wid,
        security: [{ bearerAuth: [] }],
        querystring: analyticsQuery,
      },
    },
    async (request) => {
      const { id } = await app.requireWorkspace(request);
      const q = request.query as any;
      if (q.projectId) await projectInWorkspace(app.prisma, id, q.projectId);
      const createdAt =
        q.from || q.to
        ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined }
          : undefined;
      const tasks: any[] = await app.prisma.task.findMany({
        where: {
          workspaceId: id,
          projectId: q.projectId,
          deletedAt: null,
          createdAt,
        },
        select: {
          id: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          projectId: true,
          assigneeId: true,
          project: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      });
      const countBy = (key: "status" | "priority") =>
        Object.entries(
          tasks.reduce<Record<string, number>>(
            (a, t) => ({ ...a, [t[key]]: (a[t[key]] ?? 0) + 1 }),
            {},
          ),
        ).map(([name, count]) => ({ name, count }));
      const projects = [...new Set(tasks.map((t) => t.projectId))].map(
        (projectId) => {
          const list = tasks.filter((t) => t.projectId === projectId);
          return {
            projectId,
            name: list[0]?.project.name,
            total: list.length,
            progress: list.length
              ? Math.round(
                  (list.filter((t) => t.status === "DONE").length /
                    list.length) *
                    100,
                )
              : 0,
          };
        },
      );
      const members = [
        ...new Set(tasks.map((t) => t.assigneeId).filter(Boolean)),
      ].map((assigneeId) => ({
        assigneeId,
        name: tasks.find((t) => t.assigneeId === assigneeId)?.assignee?.name,
        openTasks: tasks.filter(
          (t) => t.assigneeId === assigneeId && t.status !== "DONE",
        ).length,
      }));
      return data(request, {
        tasksByStatus: countBy("status"),
        tasksByPriority: countBy("priority"),
        overdueCount: tasks.filter(
          (t) => t.dueDate && t.dueDate < new Date() && t.status !== "DONE",
        ).length,
        completionTrend: tasks
          .filter((t) => t.completedAt)
          .map((t) => ({ date: t.completedAt, count: 1 })),
        projectProgress: projects,
        workloadByMember: members,
      });
    },
  );
  app.get(
    "/activities",
    {
      schema: {
        tags: ["Activities"],
        params: wid,
        security: [{ bearerAuth: [] }],
        querystring: Type.Object(
          {
            page: Type.Optional(Type.Integer({ minimum: 1 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const { id } = await app.requireWorkspace(request);
      const { page, limit } = pageOf(request.query as any);
      const where = { workspaceId: id };
      const [items, total] = await app.prisma.$transaction([
        app.prisma.activity.findMany({
          where,
          include: {
            actor: { select: { id: true, name: true, avatarUrl: true } },
            project: { select: { id: true, name: true } },
            task: { select: { id: true, title: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        app.prisma.activity.count({ where }),
      ]);
      return paginated(request, items, page, limit, total);
    },
  );
  const aiHandler = async (request: any) => {
    const { id } = await app.requireWorkspace(request);
    const body = request.body as any;
    if (body.projectId)
      await projectInWorkspace(app.prisma, id, body.projectId);
    const [workspace, projects, tasks] = await app.prisma.$transaction([
      app.prisma.workspace.findUniqueOrThrow({
        where: { id },
        select: { name: true },
      }),
      app.prisma.project.findMany({
        where: { workspaceId: id, id: body.projectId, archivedAt: null },
        select: { id: true, name: true, status: true, dueDate: true },
      }),
      app.prisma.task.findMany({
        where: { workspaceId: id, projectId: body.projectId, deletedAt: null },
        select: {
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          assignee: { select: { name: true } },
        },
        take: 500,
      }),
    ]);
    return data(
      request,
      await askAssistant(body.intent, {
        workspace: workspace.name,
        projects,
        tasks,
      }),
    );
  };
  app.post(
    "/ai/ask",
    {
      schema: {
        tags: ["AI"],
        params: wid,
        security: [{ bearerAuth: [] }],
        body: aiBody,
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    aiHandler,
  );
  app.post(
    "/ai/weekly-update",
    {
      schema: {
        tags: ["AI"],
        params: wid,
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          { projectId: Type.Optional(Type.String({ format: "uuid" })) },
          { additionalProperties: false },
        ),
      },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request) => {
      (request.body as any).intent = "GENERATE_WEEKLY_UPDATE";
      return aiHandler(request);
    },
  );
  if (env.aiMock)
    app.log.warn("AI assistant is running in deterministic mock mode");
};
export default routes;
