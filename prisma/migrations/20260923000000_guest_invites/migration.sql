-- CreateEnum
CREATE TYPE "VisitKind" AS ENUM ('TALK', 'WORKSHOP', 'COMPANY_VISIT');

-- AlterTable
ALTER TABLE "SpeakerSubmission" ADD COLUMN     "inviteExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inviteTokenHash" TEXT,
ADD COLUMN     "inviteUsedAt" TIMESTAMP(3),
ADD COLUMN     "kind" "VisitKind" NOT NULL DEFAULT 'TALK';

-- CreateIndex
CREATE UNIQUE INDEX "SpeakerSubmission_inviteTokenHash_key" ON "SpeakerSubmission"("inviteTokenHash");
