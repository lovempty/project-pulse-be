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

Create an API key in the [Anthropic Console](https://console.anthropic.com/) and configure it only in the backend `.env` file:

```env
ANTHROPIC_API_KEY=your-server-side-key
ANTHROPIC_MODEL=claude-sonnet-5
AI_MOCK_MODE=false
AI_TIMEOUT_MS=20000
AI_MAX_OUTPUT_TOKENS=1600
AI_MAX_CONTEXT_TASKS=250
```

Never place `ANTHROPIC_API_KEY` in a frontend environment file or call Claude from a browser component. The backend authorizes the workspace and gathers projects, tasks, workload, metrics, and recent activity directly through Prisma. Client-supplied project metrics are never accepted.

Development automatically uses deterministic mock mode when the key is absent. Set `AI_MOCK_MODE=true` to enable it explicitly. Production startup fails when live mode has no key; mock results retain the production response shape and identify their mode as `MOCK`.

Existing intent request:

```bash
curl -X POST http://localhost:3001/api/v1/workspaces/WORKSPACE_ID/ai/ask \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"intent":"IDENTIFY_RISKS","projectId":null,"history":[]}'
```

Custom project-scoped question with follow-up history:

```bash
curl -X POST http://localhost:3001/api/v1/workspaces/WORKSPACE_ID/ai/ask \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"Which release task needs attention first?","projectId":"PROJECT_ID","history":[{"role":"USER","content":"Focus on delivery risk."}]}'
```

`question` takes precedence over `intent`. History supports up to six `USER` or `ASSISTANT` turns. `GET /api/v1/workspaces/:workspaceId/ai/capabilities` reports the configured provider, model, and live/mock mode without revealing credentials.

Claude uses the Messages API with JSON Schema structured output. The server independently validates the result, removes evidence references to entities outside the authorized context, maps upstream failures to safe error codes, and never logs full prompts, questions, context, or responses.

Files use a local disk adapter in development; implement `StorageAdapter` for an S3-compatible provider without changing HTTP handlers.

## Quality commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Integration tests require a disposable PostgreSQL database in `TEST_DATABASE_URL` or `DATABASE_URL`; never point tests at a database containing valuable data.
