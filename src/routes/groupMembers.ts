import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function addUserToGroup(
  userId: number,
  groupId: number,
  role: string = "owner"
) {
  return await prisma.groupMember.create({
    data: { userId, groupId, role },
  });
}

export async function groupMemberRoutes(app: FastifyInstance) {
  // GET /groupMembers — protected
  app.get(
    "/groupMembers",
    { preHandler: [app.authenticate] },
    async () => {
      return prisma.groupMember.findMany({
        include: { user: true, group: true },
      });
    }
  );

  // POST /groups/:id/members — protected
  app.post(
    "/groups/:id/members",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const { userId, role } = request.body as {
        userId: number;
        role?: string;
      };

      try {
        const membership = await addUserToGroup(userId, groupId, role ?? "member");
        return membership;
      } catch {
        reply.status(400).send({ error: "Adding member failed" });
      }
    }
  );

  // GET /groups/:id/members — protected
  app.get(
    "/groups/:id/members",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);

      try {
        return prisma.groupMember.findMany({
          where: { groupId },
          include: { user: true },
        });
      } catch {
        reply.status(400).send({ error: "Fetching members failed" });
      }
    }
  );
}
