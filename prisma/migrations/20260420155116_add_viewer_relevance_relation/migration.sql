-- AddForeignKey
ALTER TABLE "message_viewer_relevance" ADD CONSTRAINT "message_viewer_relevance_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
