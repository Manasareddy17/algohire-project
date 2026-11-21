import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * Same role as TypeORM's EntityManager: the root client, or the client bound to an open
 * transaction. Database services take it as their last argument so a handler can run
 * several of them inside one transaction.
 */
export type EntityManager = PrismaClient | Prisma.TransactionClient;
