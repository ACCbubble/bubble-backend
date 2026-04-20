import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireGroupMemberAccess } from "../lib/access.js";

export async function addUserToGroup(
  userId: number,
  groupId: number,
  role: string = "owner",
) {
  return prisma.groupMember.upsert({
    where: { userId_groupId: { userId, groupId } },
    update: { role },
    create: { userId, groupId, role },
  });
}

export async function groupMemberRoutes(app: FastifyInstance) {
  app.get(
    "/groupMembers",
    { preHandler: [app.authenticate] },
    async (request) => {
      const userId = request.user.userId;
      return prisma.groupMember.findMany({
        where: { userId },
        include: { group: true },
      });
    },
  );

  app.post(
    "/groups/:id/members",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const requesterId = request.user.userId;
      const { userId, phone, role } = request.body as {
        userId?: number;
        phone?: string;
        role?: string;
      };

      if (!(await requireGroupMemberAccess(requesterId, groupId, reply))) return;

      let targetUserId = userId;
      if (!targetUserId && phone) {
        const user = await prisma.user.findUnique({ where: { phone } });
        if (!user) return reply.status(404).send({ error: "User not found" });
        targetUserId = user.id;
      }

      if (!targetUserId) {
        return reply.status(400).send({ error: "userId or phone is required" });
      }

      try {
        const membership = await addUserToGroup(targetUserId, groupId, role ?? "member");
        return membership;
      } catch {
        return reply.status(400).send({ error: "Adding member failed" });
      }
    },
  );

  app.get(
    "/groups/:id/members",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const userId = request.user.userId;

      if (!(await requireGroupMemberAccess(userId, groupId, reply))) return;

      try {
        return prisma.groupMember.findMany({
          where: { groupId },
          include: { user: { select: { id: true, name: true, phone: true } } },
          orderBy: { id: "asc" },
        });
      } catch {
        return reply.status(400).send({ error: "Fetching members failed" });
      }
    },
  );
}
