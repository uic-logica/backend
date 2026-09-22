-- DropForeignKey
ALTER TABLE "BoardItem" DROP CONSTRAINT "BoardItem_createdById_fkey";

-- AlterTable
ALTER TABLE "BoardItem" ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
