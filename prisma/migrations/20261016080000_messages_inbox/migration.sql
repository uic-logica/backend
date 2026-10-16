CREATE TABLE "BoardMessage" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoardMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ThreadRead" (
    "userId" TEXT NOT NULL,
    "thread" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ThreadRead_pkey" PRIMARY KEY ("userId","thread")
);
CREATE INDEX "BoardMessage_memberId_createdAt_idx" ON "BoardMessage"("memberId", "createdAt");
ALTER TABLE "BoardMessage" ADD CONSTRAINT "BoardMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardMessage" ADD CONSTRAINT "BoardMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreadRead" ADD CONSTRAINT "ThreadRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
