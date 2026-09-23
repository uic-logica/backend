import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// DB_SCHEMA runs the app against a non-default Postgres schema — QA lives in
// `qa`, beside production's `public` in the same database. Unset everywhere
// else, which leaves Prisma on `public`. Generated queries are schema-qualified,
// so without this they hit `public` no matter what the connection string says.
const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL },
  process.env.DB_SCHEMA ? { schema: process.env.DB_SCHEMA } : undefined,
);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
