import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function eventRoutes(app: FastifyInstance) {
  // GET /groups/:id/events — list events in a group (members only)
  app.get(
    "/groups/:id/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const userId = request.user.userId;

      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });
      if (!membership) return reply.status(403).send({ error: "Not a member" });

      return prisma.event.findMany({
        where: { groupId },
        orderBy: { createdAt: "desc" },
      });
    }
  );

  // POST /groups/:id/events — create event in a group
  app.post(
    "/groups/:id/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const creatorId = request.user.userId;
      const { name, location, eventTime, description } = request.body as {
        name: string;
        location?: string;
        eventTime?: string;
        description?: string;
      };

      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: creatorId, groupId } },
      });
      if (!membership) return reply.status(403).send({ error: "Not a member" });

      try {
        const event = await prisma.event.create({
          data: {
            groupId,
            creatorId,
            name,
            ...(location !== undefined && { location }),
            ...(eventTime !== undefined && { eventTime: eventTime ? new Date(eventTime) : null }),
            ...(description !== undefined && { description }),
          },
        });
        return event;
      } catch {
        reply.status(400).send({ error: "Event creation failed" });
      }
    }
  );

  // GET /events/:id
  app.get(
    "/events/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const userId = request.user.userId;

      const event = await prisma.event.findUnique({ where: { id } });
      if (!event) return reply.status(404).send({ error: "Event not found" });

      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId: event.groupId } },
      });
      if (!membership) return reply.status(403).send({ error: "Not a member" });

      return event;
    }
  );

  // PATCH /events/:id — update event details
  app.patch(
    "/events/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      return reply.status(403).send({ error: "Event details are managed by poll results" });
    }
  );
}
