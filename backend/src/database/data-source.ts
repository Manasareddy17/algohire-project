import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.service';

/**
 * Thin wrapper that gives Prisma the TypeORM DataSource API used across our services:
 *
 *   await this.dataSource.transaction(async (manager) => { ... });
 *
 * Everything done through `manager` commits together or rolls back together.
 */
export class DataSource {
  constructor(private readonly client: PrismaClient = prisma) {}

  get manager(): PrismaClient {
    return this.client;
  }

  transaction<T>(work: (manager: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.client.$transaction(work, { maxWait: 10_000, timeout: 30_000 });
  }
}

export const dataSource = new DataSource();
