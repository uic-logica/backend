import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// DB_SCHEMA runs the app against a non-default Postgres schema — QA lives in
// `qa`, beside production's `public` in the same database. Unset everywhere
// else, which leaves Prisma on `public`. Generated queries are schema-qualified,
// so without this they hit `public` no matter what the connection string says.
// pg's defaults wait forever for a free connection and never time a query out,
// so one stuck query or a burst of requests would hang until the function is killed.
const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000, query_timeout: 15_000 },
  process.env.DB_SCHEMA ? { schema: process.env.DB_SCHEMA } : undefined,
);

// The photo (≤2 MB) and resume (≤5 MB) bytes live on User, and Auth.js loads
// the whole User row on every session check. Leave them out of every query;
// the routes that serve them ask for them with an explicit `select`.
const createClient = () => new PrismaClient({
  adapter,
  omit: { user: { photoData: true, resumeData: true } },
});

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
