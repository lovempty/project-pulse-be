import { PrismaClient, type TaskStatus, type TaskPriority } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const today = new Date();
const days = (n: number) => new Date(today.getTime() + n * 86_400_000);
const year = today.getUTCFullYear() + (today.getUTCMonth() > 9 ? 1 : 0);

async function main() {
  await prisma.session.deleteMany();
  await prisma.workspace.deleteMany({ where: { slug: 'acme-studio' } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@projectpulse.dev' } } });
  const passwordHash = await argon2.hash('PulseDemo123!');
  const people = [
    ['Alex Rivera', 'alex@projectpulse.dev', 'Product Manager'],
    ['Nina Singh', 'nina@projectpulse.dev', 'Product Designer'],
    ['James Lee', 'james@projectpulse.dev', 'Software Engineer'],
    ['Rina Matsuda', 'rina@projectpulse.dev', 'Software Engineer'],
    ['David Brooks', 'david@projectpulse.dev', 'Marketing'],
    ['Chloe Hart', 'chloe@projectpulse.dev', 'Product Designer']
  ];
  const users = await Promise.all(people.map(([name, email, jobTitle]) => prisma.user.create({ data: { name: name!, email: email!, jobTitle, passwordHash, avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name!)}` } })));
  const alex = users[0]!;
  const nina = users[1]!;
  const workspace = await prisma.workspace.create({ data: { name: 'Acme Studio', slug: 'acme-studio', createdById: alex.id, members: { create: users.map((user, index) => ({ userId: user.id, role: index === 0 ? 'OWNER' : index === 1 ? 'ADMIN' : 'MEMBER' })) } } });
  const labels = await Promise.all([['Design', '#8B5CF6'], ['Engineering', '#3B82F6'], ['Marketing', '#F59E0B'], ['Bug', '#EF4444'], ['Research', '#10B981']].map(([name, color]) => prisma.label.create({ data: { workspaceId: workspace.id, name: name!, color: color! } })));
  const projectSpecs = [
    { name: 'Mobile App Redesign', key: 'MAR', color: '#8B5CF6', dueDate: new Date(`${year}-09-18T17:00:00Z`), total: 12, done: 9, titles: ['Create onboarding empty states', 'Mobile navigation QA', 'Design system tokens', 'Homepage wireframes'] },
    { name: 'Q3 Marketing Campaign', key: 'Q3', color: '#F59E0B', dueDate: new Date(`${year}-09-24T17:00:00Z`), total: 8, done: 5, titles: ['Finalize pricing copy', 'Campaign assets', 'Launch email sequence'] },
    { name: 'API v2.0', key: 'API', color: '#3B82F6', dueDate: new Date(`${year}-10-02T17:00:00Z`), total: 11, done: 5, titles: ['Project overview API', 'API authentication', 'Build analytics dashboard', 'Rate limit middleware'] },
    { name: 'Customer Portal', key: 'CP', color: '#10B981', dueDate: new Date(`${year}-10-12T17:00:00Z`), total: 13, done: 4, titles: ['Workspace invite flow', 'Checkout flow', 'Account settings', 'Billing history'] }
  ];
  let firstOpenTaskId = '';
  for (const [projectIndex, spec] of projectSpecs.entries()) {
    const project = await prisma.project.create({ data: { workspaceId: workspace.id, name: spec.name, key: spec.key, color: spec.color, status: 'ACTIVE', description: `${spec.name} delivery plan and cross-functional work.`, startDate: days(-45 + projectIndex * 5), dueDate: spec.dueDate, createdById: alex.id, members: { create: users.map((user) => ({ userId: user.id })) } } });
    const titles = [...spec.titles, ...Array.from({ length: spec.total - spec.titles.length }, (_, i) => `${spec.key} delivery task ${i + 1}`)];
    for (let i = 0; i < spec.total; i++) {
      const done = i < spec.done; const status: TaskStatus = done ? 'DONE' : (['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW'] as TaskStatus[])[(i - spec.done) % 4]!; const priority: TaskPriority = (['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as TaskPriority[])[(i + projectIndex) % 4]!; const assignee = users[(i + projectIndex) % users.length]!;
      const task = await prisma.task.create({ data: { workspaceId: workspace.id, projectId: project.id, title: titles[i]!, description: `Deliver ${titles[i]!.toLowerCase()} with acceptance criteria, review, and stakeholder sign-off.`, status, priority, position: i, assigneeId: assignee.id, reporterId: alex.id, dueDate: !done && i === spec.done ? days(-3 - projectIndex) : days(i - spec.done + 4), completedAt: done ? days(-20 + i) : null, labels: { create: [{ labelId: labels[(i + projectIndex) % labels.length]!.id }] } } });
      if (!done && !firstOpenTaskId) firstOpenTaskId = task.id;
      if (i === spec.done) await prisma.comment.create({ data: { taskId: task.id, authorId: nina.id, body: 'I added the latest context and flagged the remaining dependency for the team.' } });
      if (i === spec.done + 1) await prisma.task.create({ data: { workspaceId: workspace.id, projectId: project.id, parentTaskId: task.id, title: 'Confirm acceptance criteria', status: 'TODO', priority: 'MEDIUM', position: 0, reporterId: alex.id, assigneeId: assignee.id, dueDate: days(2) } });
    }
    await prisma.activity.createMany({ data: [{ workspaceId: workspace.id, actorId: alex.id, projectId: project.id, action: 'PROJECT_CREATED', metadata: { name: project.name } }, { workspaceId: workspace.id, actorId: users[(projectIndex + 1) % users.length]!.id, projectId: project.id, action: 'TASK_STATUS_CHANGED', metadata: { projectKey: project.key } }] });
  }
  await prisma.activity.create({ data: { workspaceId: workspace.id, actorId: alex.id, taskId: firstOpenTaskId, action: 'COMMENT_ADDED', metadata: { seeded: true } } });
  console.log('Seed complete. Sign in with alex@projectpulse.dev / PulseDemo123!');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
