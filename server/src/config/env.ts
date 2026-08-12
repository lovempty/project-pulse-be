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

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: integer('PORT', 3001),
  databaseUrl: required('DATABASE_URL', 'postgresql://projectpulse:projectpulse@localhost:5432/projectpulse?schema=public'),
  accessSecret: required('JWT_ACCESS_SECRET', 'development-access-secret-change-me-32-chars'),
  refreshSecret: required('JWT_REFRESH_SECRET', 'development-refresh-secret-change-me-32-chars'),
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((v) => v.trim()),
  openAiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  aiMock: process.env.AI_MOCK_MODE === 'true' || !process.env.OPENAI_API_KEY,
  aiTimeoutMs: integer('AI_TIMEOUT_MS', 15000),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  maxUploadSize: integer('MAX_UPLOAD_SIZE', 10 * 1024 * 1024),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  isProduction: process.env.NODE_ENV === 'production'
} as const;
