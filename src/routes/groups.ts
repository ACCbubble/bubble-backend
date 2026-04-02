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
}
