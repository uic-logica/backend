-- AlterTable
ALTER TABLE "SpeakerSubmission" ADD COLUMN "threadId" TEXT;

-- CreateIndex
CREATE INDEX "SpeakerSubmission_threadId_idx" ON "SpeakerSubmission"("threadId");

-- AddForeignKey
ALTER TABLE "SpeakerSubmission" ADD CONSTRAINT "SpeakerSubmission_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SpeakerSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
