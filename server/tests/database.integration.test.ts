import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.skipIf(!enabled)('database constraints', () => {
  const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  it('connects to the isolated test database', async () => { expect(await prisma.$queryRaw`SELECT 1 AS value`).toEqual([{ value: 1 }]); });
});
