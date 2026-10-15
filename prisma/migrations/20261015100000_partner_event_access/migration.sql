-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'PARTNER';

-- CreateTable
CREATE TABLE "EventAccess" (
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAccess_pkey" PRIMARY KEY ("userId","eventId")
);

-- CreateIndex
CREATE INDEX "EventAccess_eventId_idx" ON "EventAccess"("eventId");

-- AddForeignKey
ALTER TABLE "EventAccess" ADD CONSTRAINT "EventAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAccess" ADD CONSTRAINT "EventAccess_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
