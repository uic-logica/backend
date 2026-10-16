CREATE TABLE "AgentActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tool" TEXT,
    "via" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentActivity_userId_createdAt_idx" ON "AgentActivity"("userId", "createdAt");
ALTER TABLE "AgentActivity" ADD CONSTRAINT "AgentActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
