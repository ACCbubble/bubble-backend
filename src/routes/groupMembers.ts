import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function addUserToGroup(
  userId: number,
  groupId: number,
  role: string = "owner"
) {
  return await prisma.groupMember.create({
    data: {
      userId,
      groupId,
      role,
    },
  });
}


export async function groupMemberRoutes(app: FastifyInstance) {
  app.get("/groupMembers", async () => {
    const memberships = await prisma.groupMember.findMany({
        include: {
        user: true,
        group: true,
        },
    });

    return memberships;
    });




  app.post("/groups/:id/members", async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const { userId, role } = request.body as {
      userId: number;
      role?: string;
    };

    try {
      const membership = await addUserToGroup(userId, groupId, role ?? "member");
      return membership;
    } catch (error) {
      reply.status(400).send({ error: "Adding member failed" });
    }
  });

  app.get("/groups/:id/members", async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);

    try {
      const members = await prisma.groupMember.findMany({
        where: { groupId },
        include: {
          user: true,
        },
      });

      return members;
    } catch (error) {
      reply.status(400).send({ error: "Fetching members failed" });
    }
  });
}