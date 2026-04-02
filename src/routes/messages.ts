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