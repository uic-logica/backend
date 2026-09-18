-- CreateEnum
CREATE TYPE "MaterialVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "resumeUrl",
ADD COLUMN     "resumeData" BYTEA,
ADD COLUMN     "resumeFilename" TEXT,
ADD COLUMN     "resumeMimeType" TEXT;

-- CreateTable
CREATE TABLE "EventMaterial" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "visibility" "MaterialVisibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMaterial_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMaterial" ADD CONSTRAINT "EventMaterial_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMaterial" ADD CONSTRAINT "EventMaterial_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

