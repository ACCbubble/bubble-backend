import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function userRoutes(app: FastifyInstance) {

  // Create a new user
  app.post("/users", async (request, reply) => {
    const { username, email } = request.body as { username: string; email: string };
    try {
      const user = await prisma.user.create({
        data: { username, email },
      });
      return user;
    } catch (error) {
      reply.status(400).send({ error: "User creation failed" });
    }
  });

  // Get all users
  app.get("/users", async (request, reply) => {
    const users = await prisma.user.findMany();
    return users;
  });

  // Optional: get user by ID
  app.get("/users/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }
    return user;
  });

};