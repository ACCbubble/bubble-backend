import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { processMessageContext } from "../lib/context.js";
import { contextBus } from "../lib/contextBroadcast.js";

export async function messageRoutes(app: FastifyInstance) {

  // ===============================
  // SEND MESSAGE
  // ===============================
  // Creates a new message in a group (conversation)
  app.post("/messages", async (request, reply) => {
    const { groupId, senderId, content } = request.body as {
      groupId: number;
      senderId: number;
      content: string;
    };

    try {
      const message = await prisma.message.create({
        data: { groupId, senderId, content },
        include: { sender: { select: { id: true, name: true } } },
      });

      // Ensure sender is a group member (idempotent)
      await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: senderId, groupId } },
        update: {},
        create: { userId: senderId, groupId, role: "member" },
      });

      // Broadcast new message to group WebSocket clients
      contextBus.emit('message_created', { groupId, message })

      // Fire context processing async — does not block the response
      processMessageContext(message.id, message.senderId, message.groupId, message.content).catch(() => {})

      return message;
    } catch (error) {
      reply.status(400).send({ error: "Message creation failed" });
    }
  });


  // ===============================
  // GET FEED (AI-sorted by viewer relevance)
  // ===============================
  // Returns messages sorted by relevance to a specific viewer based on their attributes.
  // Relevance: high has_car → needs_ride signals matter; dietary restriction → bringing_food matters, etc.
  app.get("/groups/:id/feed", { preHandler: [app.authenticate] }, async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const { userId } = request.query as { userId?: string };
    if (!userId) return reply.status(400).send({ error: "userId required" });
    const uid = Number(userId);

    const attrs = await prisma.userAttribute.findMany({ where: { userId: uid } });
    const attrMap: Record<string, number> = {};
    for (const a of attrs) attrMap[a.key] = a.score;

    const messages = await prisma.message.findMany({
      where: { groupId },
      orderBy: { createdAt: "desc" },
      include: {
        sender: { select: { id: true, name: true } },
        contextEvidence: {
          where: { emojiTypeId: { not: null } },
          include: { emojiType: { select: { name: true } } },
        },
      },
    });

    const LAMBDA = Math.LN2 / 48; // 48h half-life for recency
    function recency(createdAt: Date) {
      return Math.exp(-LAMBDA * (Date.now() - createdAt.getTime()) / 3_600_000);
    }
    // Cross-relevance: how much does this emoji type matter to THIS viewer?
    function emojiRelevance(emojiName: string): number {
      switch (emojiName) {
        case "needs_ride":    return attrMap["has_car"] ?? 0;
        case "bringing_food": return attrMap["has_dietary_restriction"] ?? 0;
        case "coming":        return 1.0;
        default:              return 0.5;
      }
    }

    const scored = messages.map((msg) => {
      let relevanceScore = 0;
      for (const ev of msg.contextEvidence) {
        if (!ev.emojiType) continue;
        relevanceScore += emojiRelevance(ev.emojiType.name) * ev.confidence * recency(msg.createdAt);
      }
      const { contextEvidence: _, ...rest } = msg;
      return { ...rest, relevanceScore };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored;
  });

  // ===============================
  // GET MESSAGES
  // ===============================
  // Fetch all messages for a group
  app.get("/groups/:id/messages", async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);

    try {
      const messages = await prisma.message.findMany({
        where: { groupId },
        orderBy: { createdAt: "asc" },
        include: {
          sender: true, // include sender info (name, etc.)
        },
      });

      return messages;
    } catch (error) {
      reply.status(400).send({ error: "Fetching messages failed" });
    }
  });
}