import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireGroupMemberAccess } from "../lib/access.js";

export async function eventRoutes(app: FastifyInstance) {
  app.post(
    "/groups/:groupId/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { groupId: string }).groupId);
      const creatorId = request.user.userId;
      const { name, location, eventTime, description } = request.body as {
        name: string;
        location?: string;
        eventTime?: string;
        description?: string;
      };

      if (!(await requireGroupMemberAccess(creatorId, groupId, reply))) return;

      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: "Event name is required" });
      }

      try {
        const event = await prisma.event.create({
          data: {
            groupId,
            creatorId,
            name: name.trim(),
            location,
            description,
            eventTime: eventTime ? new Date(eventTime) : null,
          },
        });

        return reply.status(201).send(event);
      } catch {
        return reply.status(400).send({ error: "Event creation failed" });
      }
    },
  );

  app.get(
    "/groups/:groupId/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { groupId: string }).groupId);
      const userId = request.user.userId;

      if (!(await requireGroupMemberAccess(userId, groupId, reply))) return;

      return prisma.event.findMany({
        where: { groupId },
        orderBy: [{ eventTime: "asc" }, { createdAt: "desc" }],
      });
    },
  );

  app.get(
    "/events/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const userId = request.user.userId;

      const event = await prisma.event.findFirst({
        where: {
          id,
          group: {
            groupMembers: {
              some: { userId },
            },
          },
        },
      });

      if (!event) {
        return reply.status(404).send({ error: "Event not found" });
      }

      return event;
    },
  );

  app.patch(
    "/events/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const userId = request.user.userId;
      const { name, location, eventTime, description } = request.body as {
        name?: string;
        location?: string;
        eventTime?: string;
        description?: string;
      };

      const event = await prisma.event.findFirst({
        where: {
          id,
          group: {
            groupMembers: {
              some: { userId },
            },
          },
        },
      });

      if (!event) {
        return reply.status(404).send({ error: "Event not found" });
      }

      const isOwner = event.creatorId === userId;
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the event creator can edit this event" });
      }

      try {
        const updated = await prisma.event.update({
          where: { id },
          data: {
            ...(name !== undefined && { name: name.trim() }),
            ...(location !== undefined && { location }),
            ...(eventTime !== undefined && { eventTime: eventTime ? new Date(eventTime) : null }),
            ...(description !== undefined && { description }),
          },
        });

        return updated;
      } catch {
        return reply.status(400).send({ error: "Event update failed" });
      }
    },
  );
}
