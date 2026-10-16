-- AlterTable
ALTER TABLE "MembershipApplication" ADD COLUMN "interviewTokenHash" TEXT,
ADD COLUMN "interviewAvailability" JSONB,
ADD COLUMN "interviewAvailabilityAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipApplication_interviewTokenHash_key" ON "MembershipApplication"("interviewTokenHash");
