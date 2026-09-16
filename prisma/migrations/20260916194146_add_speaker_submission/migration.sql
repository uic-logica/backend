-- CreateEnum
CREATE TYPE "SpeakerStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- CreateTable
CREATE TABLE "SpeakerSubmission" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "organization" TEXT,
    "referredBy" TEXT,
    "availability" JSONB,
    "needs" TEXT,
    "publicOptIn" BOOLEAN NOT NULL DEFAULT false,
    "status" "SpeakerStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakerSubmission_pkey" PRIMARY KEY ("id")
);
