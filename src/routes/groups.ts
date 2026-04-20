import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { addUserToGroup } from "./groupMembers.js";

export async function groupRoutes(app: FastifyInstance) {
  app.post(
    "/groups",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { name } = request.body as { name: string };
      const creatorId = request.user.userId;

      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: "Group name is required" });
      }

      try {
        const group = await prisma.group.create({
          data: { creatorId, name: name.trim() },
        });
        await addUserToGroup(creatorId, group.id, "owner");
        return reply.status(201).send(group);
      } catch {
        return reply.status(400).send({ error: "Group creation failed" });
      }
    },
  );

  app.get("/groups", { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.userId;

    return prisma.group.findMany({
      where: {
        groupMembers: {
          some: { userId },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get(
    "/groups/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const userId = request.user.userId;

      const group = await prisma.group.findFirst({
        where: {
          id,
          groupMembers: {
            some: { userId },
          },
        },
      });

      if (!group) {
        return reply.status(404).send({ error: "Group not found" });
      }

      return group;
    },
  );
}
