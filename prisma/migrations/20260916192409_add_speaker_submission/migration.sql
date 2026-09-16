-- CreateEnum
CREATE TYPE "SpeakerStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- CreateTable
CREATE TABLE "SpeakerSubmission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT,
    "referredBy" TEXT NOT NULL,
    "availability" TIMESTAMP(3)[],
    "needs" TEXT,
    "publicOptIn" BOOLEAN NOT NULL DEFAULT false,
    "status" "SpeakerStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakerSubmission_pkey" PRIMARY KEY ("id")
);
