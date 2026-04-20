import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { addUserToGroup } from "./groupMembers.js";

async function groupView(groupId: number) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { events: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!group) return null;

  const primaryEvent = group.events[0] ?? null;
  return {
    id: group.id,
    name: group.name,
    location: primaryEvent?.location ?? null,
    eventTime: primaryEvent?.eventTime ?? null,
    description: primaryEvent?.description ?? null,
  };
}

export async function groupRoutes(app: FastifyInstance) {
  app.post(
    "/groups",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { name } = request.body as { name: string };
      const creatorId = request.user.userId;

      try {
        const group = await prisma.group.create({ data: { creatorId, name } });
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

  app.get("/groups", { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.userId;
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: { events: { orderBy: { createdAt: "asc" }, take: 1 } },
        },
      },
    });

    return memberships.map((membership) => ({
      id: membership.group.id,
      name: membership.group.name,
      location: membership.group.events[0]?.location ?? null,
      eventTime: membership.group.events[0]?.eventTime ?? null,
      description: membership.group.events[0]?.description ?? null,
    }));
  });

  app.get(
    "/groups/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const userId = request.user.userId;

      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId: id } },
      });
      if (!membership) return reply.status(403).send({ error: "Not a member" });

      const view = await groupView(id);
      if (!view) return reply.status(404).send({ error: "Group not found" });
      return view;
    }
  );

  app.patch(
    "/groups/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const userId = request.user.userId;
      const { name, location, eventTime, description } = request.body as {
        name?: string;
        location?: string | null;
        eventTime?: string | null;
        description?: string | null;
      };

      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId: id } },
      });
      if (!membership) return reply.status(403).send({ error: "Not a member" });

      try {
        if (name !== undefined) {
          await prisma.group.update({ where: { id }, data: { name } });
        }

        const wantsPrimaryEventUpdate =
          name !== undefined ||
          location !== undefined ||
          eventTime !== undefined ||
          description !== undefined;

        if (wantsPrimaryEventUpdate) {
          const primaryEvent = await prisma.event.findFirst({
            where: { groupId: id },
            orderBy: { createdAt: "asc" },
          });

          const eventData = {
            ...(name !== undefined && { name }),
            ...(location !== undefined && { location }),
            ...(eventTime !== undefined && { eventTime: eventTime ? new Date(eventTime) : null }),
            ...(description !== undefined && { description }),
          };

          if (primaryEvent) {
            await prisma.event.update({
              where: { id: primaryEvent.id },
              data: eventData,
            });
          } else {
            const group = await prisma.group.findUnique({ where: { id } });
            if (!group) return reply.status(404).send({ error: "Group not found" });

            await prisma.event.create({
              data: {
                groupId: id,
                creatorId: userId,
                name: name ?? group.name,
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

  app.post(
    "/groups/:id/invite",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const { phone } = request.body as { phone: string };
      const requesterId = request.user.userId;

      const requesterMembership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: requesterId, groupId } },
      });
      if (!requesterMembership) {
        return reply.status(403).send({ error: "Not a member of this group" });
      }

      const user = await prisma.user.findUnique({ where: { phone } });
      if (!user) return reply.status(404).send({ error: "No user with that phone number" });

      try {
        const membership = await prisma.groupMember.upsert({
          where: { userId_groupId: { userId: user.id, groupId } },
          update: {},
          create: { userId: user.id, groupId, role: "member" },
        });
        return { success: true, membership, user: { id: user.id, name: user.name } };
      } catch {
        reply.status(400).send({ error: "Failed to add user to group" });
      }
    }
  );
}
