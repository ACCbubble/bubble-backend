import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

const GAP_MS = 10 * 60_000;

// Only fills missing conversation IDs; existing assignments are never overwritten.
export async function backfillConversations() {
  const events = await prisma.event.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  });

  let updated = 0;
  let created = 0;

  for (const event of events) {
    const counts = await prisma.$transaction(async (tx) => {
      // Uses the same event lock as createMessageWithConversation().
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM events WHERE id = ${event.id} FOR UPDATE`,
      );

      const messages = await tx.message.findMany({
        where: { eventId: event.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          eventId: true,
          createdAt: true,
          replyToId: true,
          conversationId: true,
        },
      });

      const existingIds = [
        ...new Set(
          messages
            .map((message) => message.conversationId)
            .filter((id): id is number => id !== null),
        ),
      ];

      const existing = await tx.conversation.findMany({
        where: { id: { in: existingIds } },
        select: { id: true, eventId: true },
      });

      if (
        existing.length !== existingIds.length ||
        existing.some((conversation) => conversation.eventId !== event.id)
      ) {
        throw new Error(
          `Event ${event.id} has a conversation assigned to another event`,
        );
      }

      const byId = new Map<number, number>();

      let latestNormal:
        | { createdAt: Date; conversationId: number }
        | undefined;

      let eventUpdated = 0;
      let eventCreated = 0;

      for (const message of messages) {
        let conversationId = message.conversationId;

        if (message.replyToId !== null) {
          // Replies inherit the conversation of their original message.
          const parentId = byId.get(message.replyToId);

          if (parentId === undefined) {
            throw new Error(
              `Message ${message.id} has an invalid or later reply parent`,
            );
          }

          if (conversationId !== null && conversationId !== parentId) {
            throw new Error(
              `Message ${message.id} conflicts with its parent's conversation`,
            );
          }

          conversationId ??= parentId;
        } else if (conversationId === null) {
          // Nearby normal messages share a conversation.
          if (
            latestNormal &&
            message.createdAt.getTime() -
              latestNormal.createdAt.getTime() <= GAP_MS
          ) {
            conversationId = latestNormal.conversationId;
          }
        }

        if (conversationId === null) {
          const conversation = await tx.conversation.create({
            data: { eventId: event.id },
          });

          conversationId = conversation.id;
          eventCreated++;
        }

        if (message.conversationId === null) {
          await tx.message.update({
            where: { id: message.id },
            data: { conversationId },
          });

          eventUpdated++;
        }

        byId.set(message.id, conversationId);

        // Replies to older threads do not change the active conversation.
        if (message.replyToId === null) {
          latestNormal = {
            createdAt: message.createdAt,
            conversationId,
          };
        }
      }

      return { eventUpdated, eventCreated };
    });

    updated += counts.eventUpdated;
    created += counts.eventCreated;
  }

  return {
    events: events.length,
    updated,
    created,
  };
}
