import 'dotenv/config';

const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
const integer = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

export function resolveAiMockMode(nodeEnv: string, configuredMode: string | undefined, apiKey: string | undefined) {
  const explicitlyMocked = configuredMode === 'true';
  if (nodeEnv === 'production' && !explicitlyMocked && !apiKey?.trim()) {
    throw new Error('ANTHROPIC_API_KEY is required in production when AI_MOCK_MODE is not true');
  }
  return explicitlyMocked || (nodeEnv !== 'production' && !apiKey?.trim());
}

const isVercel = Boolean(process.env.VERCEL);
const nodeEnv = isVercel ? 'production' : (process.env.NODE_ENV ?? 'development');

export const env = {
  nodeEnv,
  host: process.env.HOST ?? '0.0.0.0',
  port: integer('PORT', 3001),
  databaseUrl: required('DATABASE_URL'),
  accessSecret: required('JWT_ACCESS_SECRET', 'development-access-secret-change-me-32-chars'),
  refreshSecret: required('JWT_REFRESH_SECRET', 'development-refresh-secret-change-me-32-chars'),
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((v) => v.trim()),
  anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
  aiMock: resolveAiMockMode(nodeEnv, process.env.AI_MOCK_MODE, process.env.ANTHROPIC_API_KEY),
  aiTimeoutMs: integer('AI_TIMEOUT_MS', 20000),
  aiMaxOutputTokens: integer('AI_MAX_OUTPUT_TOKENS', 1600),
  aiMaxContextTasks: integer('AI_MAX_CONTEXT_TASKS', 250),
  uploadDir: isVercel ? '/tmp/project-pulse-uploads' : (process.env.UPLOAD_DIR ?? './uploads'),
  maxUploadSize: integer('MAX_UPLOAD_SIZE', 10 * 1024 * 1024),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  isProduction: nodeEnv === 'production'
} as const;
