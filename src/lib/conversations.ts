
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

const CONVERSATION_GAP_MINUTES = 10;

export class ConversationError extends Error {}

// Creates a message and assigns its conversation in one database transaction.
export async function createMessageWithConversation(input: {
  eventId: number;
  senderId: number;
  content: string;
  replyToId?: number;
}) {
  return prisma.$transaction(async (tx) => {
    // Lock this event while assigning conversations.
    // This prevents two messages arriving together from creating separate
    // conversations when they should belong to the same one.
    const events = await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM events WHERE id = ${input.eventId} FOR UPDATE`,
    );

    if (events.length === 0) {
      throw new ConversationError("Event not found");
    }

    let conversationId: number | undefined;

    if (input.replyToId !== undefined) {
      // A reply stays in the conversation of its original message.
      const parent = await tx.message.findUnique({
        where: { id: input.replyToId },
        select: { eventId: true, conversationId: true },
      });

      if (!parent || parent.eventId !== input.eventId) {
        throw new ConversationError("Invalid reply");
      }

      if (parent.conversationId === null) {
        throw new ConversationError(
          "Original message has not been grouped yet",
        );
      }

      conversationId = parent.conversationId;
    } else {
      // Replies to older conversations do not change the active conversation.
      const latest = await tx.message.findFirst({
        where: {
          eventId: input.eventId,
          replyToId: null,
          conversationId: { not: null },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true, conversationId: true },
      });

      if (latest && latest.conversationId !== null) {
        const gap = Date.now() - latest.createdAt.getTime();

        if (gap >= 0 && gap <= CONVERSATION_GAP_MINUTES * 60_000) {
          conversationId = latest.conversationId;
        }
      }
    }

    if (conversationId === undefined) {
      const conversation = await tx.conversation.create({
        data: { eventId: input.eventId },
      });

      conversationId = conversation.id;
    }

    // Save the message and its conversation together.
    return tx.message.create({
      data: {
        eventId: input.eventId,
        senderId: input.senderId,
        content: input.content,
        conversationId,
        replyToId: input.replyToId ?? null,
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
    });
  });
}
