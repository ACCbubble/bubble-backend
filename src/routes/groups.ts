import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { addUserToGroup } from "./groupMembers.js";

export async function groupRoutes(app: FastifyInstance) {
  app.post("/groups", async (request, reply) => {
    const { creatorId, name } = request.body as {
      creatorId: number;
      name: string;
    };

    try {
      const group = await prisma.group.create({
        data: {
          creatorId,
          name,
        },
      });
      await addUserToGroup(creatorId, group.id, "owner");

      return group;
    } catch (error) {
      reply.status(400).send({ error: "Group creation failed" });
    }
  });

  app.get("/groups", async () => {
    const groups = await prisma.group.findMany();
    return groups;
  });

  app.get("/groups/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);

    const group = await prisma.group.findUnique({
      where: { id },
    });

    if (!group) {
      return reply.status(404).send({ error: "Group not found" });
    }

    return group;
  });
}