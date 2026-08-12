import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', testTimeout: 20_000, hookTimeout: 20_000, sequence: { concurrent: false }, env: { NODE_ENV: 'test', AI_MOCK_MODE: 'true', JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-32-chars', JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-32-chars', UPLOAD_DIR: './.test-uploads' } }
});
