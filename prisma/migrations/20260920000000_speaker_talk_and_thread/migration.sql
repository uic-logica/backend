-- AlterTable
ALTER TABLE "SpeakerSubmission" ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "slidesUrl" TEXT,
ADD COLUMN     "talkTitle" TEXT;

-- CreateTable
CREATE TABLE "SpeakerMessage" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeakerMessage_submissionId_createdAt_idx" ON "SpeakerMessage"("submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakerSubmission_eventId_key" ON "SpeakerSubmission"("eventId");

-- AddForeignKey
ALTER TABLE "SpeakerSubmission" ADD CONSTRAINT "SpeakerSubmission_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerMessage" ADD CONSTRAINT "SpeakerMessage_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "SpeakerSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerMessage" ADD CONSTRAINT "SpeakerMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
