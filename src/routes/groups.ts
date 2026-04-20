import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { addUserToGroup } from "./groupMembers.js";

export async function groupRoutes(app: FastifyInstance) {
  // POST /groups — creatorId comes from the JWT, not the request body
  app.post(
    "/groups",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { name } = request.body as { name: string };
      const creatorId = request.user.userId;

      try {
        const group = await prisma.group.create({
          data: { creatorId, name },
        });
        await addUserToGroup(creatorId, group.id, "owner");
        return group;
      } catch {
        reply.status(400).send({ error: "Group creation failed" });
      }
    }
  );

  // GET /groups — protected
  app.get("/groups", { preHandler: [app.authenticate] }, async () => {
    return prisma.group.findMany();
  });

  // GET /groups/:id — protected
  app.get(
    "/groups/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const group = await prisma.group.findUnique({ where: { id } });

      if (!group) {
        return reply.status(404).send({ error: "Group not found" });
      }

      return group;
    }
  );

  // PATCH /groups/:id — update group details
  app.patch(
    "/groups/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const { name } = request.body as {
        name?: string;
      };

      try {
        const group = await prisma.group.update({
          where: { id },
          data: {
            ...(name !== undefined && { name }),
          },
        });
        return group;
      } catch {
        reply.status(400).send({ error: "Update failed" });
      }
    }
  );

  // POST /groups/:groupId/events — create an event in a group
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

      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: "Event name is required" });
      }

      try {
        const event = await prisma.event.create({
          data: {
            groupId,
            creatorId,
            name: name.trim(),
            location: location?.trim() || null,
            eventTime: eventTime ? new Date(eventTime) : null,
            description: description?.trim() || null,
          },
        });
        return reply.status(201).send(event);
      } catch {
        return reply.status(400).send({ error: "Event creation failed" });
      }
    }
  );

  // GET /groups/:groupId/events — list events under a group
  app.get(
    "/groups/:groupId/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { groupId: string }).groupId);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        return reply.status(400).send({ error: "Invalid groupId" });
      }

      return prisma.event.findMany({
        where: { groupId },
        orderBy: { eventTime: "asc" },
      });
    }
  );

  // GET /events/:id — get a single event
  app.get(
    "/events/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const event = await prisma.event.findUnique({ where: { id } });

      if (!event) {
        return reply.status(404).send({ error: "Event not found" });
      }

      return event;
    }
  );

  // PATCH /events/:id — update event details
  app.patch(
    "/events/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const { name, location, eventTime, description } = request.body as {
        name?: string;
        location?: string;
        eventTime?: string;
        description?: string;
      };

      try {
        const event = await prisma.event.update({
          where: { id },
          data: {
            ...(name !== undefined && { name }),
            ...(location !== undefined && { location }),
            ...(eventTime !== undefined && { eventTime: eventTime ? new Date(eventTime) : null }),
            ...(description !== undefined && { description }),
          },
        });
        return event;
      } catch {
        return reply.status(400).send({ error: "Update failed" });
      }
    }
  );
}
