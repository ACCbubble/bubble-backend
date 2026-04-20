import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { addUserToGroup } from "./groupMembers.js";

export async function groupRoutes(app: FastifyInstance) {
  // POST /groups — create a group, creator becomes owner
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

  // GET /groups — only groups the user is a member of
  app.get("/groups", { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.userId;
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      include: { group: true },
    });
    return memberships.map((m) => m.group);
  });

  // GET /groups/:id — only if member
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

      const group = await prisma.group.findUnique({ where: { id } });
      if (!group) return reply.status(404).send({ error: "Group not found" });
      return group;
    }
  );

  // PATCH /groups/:id — rename group (only name, not event fields)
  app.patch(
    "/groups/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const { name } = request.body as { name?: string };

      try {
        const group = await prisma.group.update({
          where: { id },
          data: { ...(name !== undefined && { name }) },
        });
        return group;
      } catch {
        reply.status(400).send({ error: "Update failed" });
      }
    }
  );

  // POST /groups/:id/invite — add a user to the group by phone number
  app.post(
    "/groups/:id/invite",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const { phone } = request.body as { phone: string };
      const requesterId = request.user.userId;

      // Must be a member to invite
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
