import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";

import { healthRoutes } from "./routes/health.js";
import { userRoutes } from "./routes/users.js";
import { groupRoutes } from "./routes/groups.js";
import { groupMemberRoutes } from "./routes/groupMembers.js";
import { authRoutes } from "./routes/auth.js";
import { isRevoked } from "./lib/tokenRevocation.js";

const app = Fastify({ logger: true });

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error("Not allowed by CORS"), false);
    }
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
});
await app.register(helmet);
await app.register(cookie);
await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  cookie: { cookieName: "access_token", signed: false },
});

// Reusable preHandler — attach to any route that requires a logged-in user.
// Sets request.user = { userId, name } on success.
app.decorate(
  "authenticate",
  async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const { jti } = request.user as { jti?: string };
      if (jti && isRevoked(jti)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    } catch {
      reply.status(401).send({ error: "Unauthorized" });
    }
  }
);

await app.register(authRoutes);
await app.register(healthRoutes);
await app.register(userRoutes);
await app.register(groupRoutes);
await app.register(groupMemberRoutes);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
