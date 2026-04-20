import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { addUserToGroup } from "./groupMembers.js";

// Returns a flat "group view" merging the group's primary event fields.
// This keeps the frontend interface stable (Group has location, eventTime, description).
async function groupView(groupId: number) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { events: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!group) return null;
  const ev = group.events[0] ?? null;
  return {
    id: group.id,
    name: group.name,
    location: ev?.location ?? null,
    eventTime: ev?.eventTime ?? null,
    description: ev?.description ?? null,
  };
}

export async function groupRoutes(app: FastifyInstance) {
  // POST /groups — creates group + auto-creates primary event
  app.post(
    "/groups",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { name } = request.body as { name: string };
      const creatorId = request.user.userId;

      try {
        const group = await prisma.group.create({ data: { creatorId, name } });
        // Auto-create primary event so messages can be attached immediately
        await prisma.event.create({
          data: { groupId: group.id, creatorId, name: name ?? "Event" },
        });
        await addUserToGroup(creatorId, group.id, "owner");
        return groupView(group.id);
      } catch {
        reply.status(400).send({ error: "Group creation failed" });
      }
    }
  );

  // GET /groups — returns all groups with their primary event details
  app.get("/groups", { preHandler: [app.authenticate] }, async () => {
    const groups = await prisma.group.findMany({
      include: { events: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    return groups.map(g => ({
      id: g.id,
      name: g.name,
      location: g.events[0]?.location ?? null,
      eventTime: g.events[0]?.eventTime ?? null,
      description: g.events[0]?.description ?? null,
    }));
  });

  // GET /groups/:id
  app.get(
    "/groups/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const view = await groupView(id);
      if (!view) return reply.status(404).send({ error: "Group not found" });
      return view;
    }
  );

  // PATCH /groups/:id — updates group name and/or primary event details
  app.patch(
    "/groups/:id",
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
        if (name !== undefined) {
          await prisma.group.update({ where: { id }, data: { name } });
        }

        // Update primary event fields if any were provided
        if (location !== undefined || eventTime !== undefined || description !== undefined) {
          const event = await prisma.event.findFirst({
            where: { groupId: id },
            orderBy: { createdAt: "asc" },
          });
          if (event) {
            await prisma.event.update({
              where: { id: event.id },
              data: {
                ...(name !== undefined && { name }),
                ...(location !== undefined && { location }),
                ...(eventTime !== undefined && { eventTime: eventTime ? new Date(eventTime) : null }),
                ...(description !== undefined && { description }),
              },
            });
          }
        }

        return groupView(id);
      } catch {
        reply.status(400).send({ error: "Update failed" });
      }
    }
  );
}
