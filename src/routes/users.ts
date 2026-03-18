import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function userRoutes(app: FastifyInstance) {
  app.post("/users", async (request, reply) => {
    const { phone, name, passwordHash } = request.body as {
      phone: string;
      name: string;
      passwordHash: string;
    };

    try {
      const user = await prisma.user.create({
        data: {
          phone,
          name,
          passwordHash,
        },
      });

      return user;
    } catch (error) {
      reply.status(400).send({ error: "User creation failed" });
    }
  });

  app.get("/users", async () => {
    const users = await prisma.user.findMany();
    return users;
  });

  app.get("/users/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return user;
  });
}