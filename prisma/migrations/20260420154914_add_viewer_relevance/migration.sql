-- CreateTable
CREATE TABLE "message_viewer_relevance" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "attribute_key" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "message_viewer_relevance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_viewer_relevance_attribute_key_score_idx" ON "message_viewer_relevance"("attribute_key", "score");

-- CreateIndex
CREATE UNIQUE INDEX "message_viewer_relevance_message_id_attribute_key_key" ON "message_viewer_relevance"("message_id", "attribute_key");
