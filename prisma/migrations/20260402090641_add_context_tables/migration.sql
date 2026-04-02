-- CreateTable
CREATE TABLE "user_attributes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emoji_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "default_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,

    CONSTRAINT "emoji_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_context_evidence" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "emoji_type_id" INTEGER,
    "attribute_key" TEXT,
    "direction" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "display_quote" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_context_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_attributes_user_id_key_key" ON "user_attributes"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "emoji_types_name_key" ON "emoji_types"("name");

-- AddForeignKey
ALTER TABLE "user_attributes" ADD CONSTRAINT "user_attributes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_context_evidence" ADD CONSTRAINT "message_context_evidence_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_context_evidence" ADD CONSTRAINT "message_context_evidence_emoji_type_id_fkey" FOREIGN KEY ("emoji_type_id") REFERENCES "emoji_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
