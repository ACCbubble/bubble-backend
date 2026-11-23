CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "messages" ADD COLUMN "conversation_id" INTEGER;
ALTER TABLE "messages" ADD COLUMN "reply_to_id" INTEGER;
CREATE INDEX "conversations_event_id_idx" ON "conversations"("event_id");
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");
CREATE INDEX "messages_reply_to_id_idx" ON "messages"("reply_to_id");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
