-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "description" TEXT,
ADD COLUMN     "event_time" TIMESTAMPTZ(6),
ADD COLUMN     "location" TEXT;
