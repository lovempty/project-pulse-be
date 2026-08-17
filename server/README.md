# ProjectPulse API

Production-oriented Fastify 5 and TypeScript backend for ProjectPulse. It provides JWT authentication, strict workspace authorization, project and task workflows, transactional Kanban ordering, comments, attachments, dashboards, analytics, activity history, and an AI project assistant.

## Local setup

Requirements: Node.js 20+, npm, and a Supabase project.

```bash
cp .env.example .env
npm install
npm run prisma:generate
npx prisma migrate deploy
npm run prisma:seed
npm run dev
```

In the Supabase dashboard, open the project and click **Connect**. Set
`DATABASE_URL` to the **Session pooler** URI for application traffic and
`DIRECT_URL` to the **Direct connection** URI for migrations. Replace the
password placeholders, URL-encoding special characters in the password. Both
URLs stay on the backend; Supabase browser keys are not used by Prisma.

If the direct endpoint is unreachable from an IPv4-only development network,
run migrations from an IPv6-capable network or use the pooler connection that
the Supabase dashboard recommends for Prisma tooling.

The API is available at `http://localhost:3001`; development Swagger UI is at `http://localhost:3001/docs`. Health probes are `/health` and `/ready`.

Seed sign-in: `alex@projectpulse.dev` / `PulseDemo123!`.

## Authentication

Register or sign in, then send the returned access token as `Authorization: Bearer <token>`. Access tokens are short-lived. The rotating refresh token is stored in an HTTP-only cookie scoped to `/api/v1/auth`; non-browser clients may alternatively send `{ "refreshToken": "..." }` to the refresh and logout endpoints. Only a SHA-256 hash is persisted. Password changes revoke all sessions.

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alex@projectpulse.dev","password":"PulseDemo123!"}'
```

All domain endpoints are under `/api/v1/workspaces/:workspaceId`. Workspace membership is checked before every scoped query. Owners control the workspace, admins manage projects/tasks/members, members edit work, and viewers are read-only.

## AI assistant and uploads

With `AI_MOCK_MODE=true` or no `OPENAI_API_KEY`, AI routes return deterministic results with the production response shape. With a key configured, only server-derived structured context is sent upstream, output is validated, and requests have a timeout. Files use a local disk adapter in development; implement `StorageAdapter` for an S3-compatible provider without changing HTTP handlers.

## Quality commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Integration tests require a disposable PostgreSQL database in `TEST_DATABASE_URL` or `DATABASE_URL`; never point tests at a database containing valuable data.
