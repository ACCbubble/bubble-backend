import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function userRoutes(app: FastifyInstance) {
  // GET /users/me — returns the currently authenticated user's info
  app.get(
    "/users/me",
    { preHandler: [app.authenticate] },
    async (request) => {
      return { userId: request.user.userId, name: request.user.name };
    }
  );

  // GET /users — protected: never returns passwordHash
  app.get("/users", { preHandler: [app.authenticate] }, async () => {
    return prisma.user.findMany({
      select: { id: true, name: true, phone: true, createdAt: true },
    });
  });

  // GET /users/:id — protected: never returns passwordHash
  app.get(
    "/users/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, phone: true, createdAt: true },
      });

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      return user;
    }
  );
}
