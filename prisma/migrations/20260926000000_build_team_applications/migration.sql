-- CreateEnum
CREATE TYPE "TeamProject" AS ENUM ('OPPORTUNITY_BOARD', 'RESUME_BUILDER', 'EVENT_REPLAYS', 'MOCK_INTERVIEWER');

-- AlterTable
ALTER TABLE "MembershipApplication"
ADD COLUMN "github" TEXT,
ADD COLUMN "hoursPerWeek" INTEGER,
ADD COLUMN "projects" "TeamProject"[] NOT NULL DEFAULT ARRAY[]::"TeamProject"[],
ADD COLUMN "skills" TEXT,
ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "MembershipApplication_userId_idx" ON "MembershipApplication"("userId");
