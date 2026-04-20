/*
  Warnings:

  - You are about to drop the column `description` on the `groups` table. All the data in the column will be lost.
  - You are about to drop the column `event_time` on the `groups` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `groups` table. All the data in the column will be lost.
  - You are about to drop the column `group_id` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `group_id` on the `polls` table. All the data in the column will be lost.
  - Added the required column `event_id` to the `messages` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_group_id_fkey";

-- DropForeignKey
ALTER TABLE "polls" DROP CONSTRAINT "polls_group_id_fkey";

-- AlterTable
ALTER TABLE "groups" DROP COLUMN "description",
DROP COLUMN "event_time",
DROP COLUMN "location";

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "group_id",
ADD COLUMN     "event_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "polls" DROP COLUMN "group_id",
ADD COLUMN     "event_id" INTEGER;

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "creator_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "event_time" TIMESTAMPTZ(6),
    "description" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
