-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'QUEUED';

-- AlterTable
ALTER TABLE "Technician" ADD COLUMN     "maxWorkload" INTEGER NOT NULL DEFAULT 5;
