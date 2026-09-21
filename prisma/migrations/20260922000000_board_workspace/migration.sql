-- CreateEnum
CREATE TYPE "Officer" AS ENUM ('PRESIDENT', 'TREASURER', 'SECRETARY', 'OUTREACH', 'OTHER');

-- CreateEnum
CREATE TYPE "BoardItemKind" AS ENUM ('MONEY', 'OUTREACH');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "officer" "Officer";

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardItem" (
    "id" TEXT NOT NULL,
    "kind" "BoardItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "detail" TEXT,
    "ownerId" TEXT,
    "nextStepAt" TIMESTAMP(3),
    "stageChangedById" TEXT,
    "stageChangedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "budgetId" TEXT,
    "amountCents" INTEGER,
    "paidByUserId" TEXT,
    "receiptUrl" TEXT,
    "org" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "channel" TEXT,
    "category" TEXT,
    "link" TEXT,
    "lastTouchAt" TIMESTAMP(3),
    "eventId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardItem_kind_stage_idx" ON "BoardItem"("kind", "stage");

-- CreateIndex
CREATE INDEX "BoardItem_ownerId_idx" ON "BoardItem"("ownerId");

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_stageChangedById_fkey" FOREIGN KEY ("stageChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
