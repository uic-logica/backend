-- AlterTable
ALTER TABLE "User"
ADD COLUMN "linkedinSub" TEXT,
ADD COLUMN "photoUrl" TEXT,
ADD COLUMN "photoData" BYTEA,
ADD COLUMN "photoMimeType" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_linkedinSub_key" ON "User"("linkedinSub");
