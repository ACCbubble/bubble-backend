import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import { WebSocketServer, WebSocket } from "ws";

import { healthRoutes } from "./routes/health.js";
import { userRoutes } from "./routes/users.js";
import { groupRoutes } from "./routes/groups.js";
import { groupMemberRoutes } from "./routes/groupMembers.js";
import { authRoutes } from "./routes/auth.js";
import { isRevoked } from "./lib/tokenRevocation.js";
import { messageRoutes } from "./routes/messages.js";
import { roundtableRoutes } from "./routes/roundtable.js";
import { prisma } from "./lib/prisma.js";
import { EMOJI_TYPE_SEEDS } from "./lib/context.js";
import { contextBus } from "./lib/contextBroadcast.js";

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
await app.register(messageRoutes);
await app.register(roundtableRoutes);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Seed emoji types (upsert so safe to run every startup)
for (const seed of EMOJI_TYPE_SEEDS) {
  await prisma.emojiType.upsert({
    where: { name: seed.name },
    update: {},
    create: seed,
  });
}

// WebSocket server — clients connect to ws://host:3000/ws?groupId=X
const wss = new WebSocketServer({ server: app.server });
const connections = new Map<number, Set<WebSocket>>();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://x");
  const groupId = Number(url.searchParams.get("groupId"));
  if (!groupId) return ws.close();

  if (!connections.has(groupId)) connections.set(groupId, new Set());
  connections.get(groupId)!.add(ws);

  ws.on("close", () => connections.get(groupId)?.delete(ws));
});

contextBus.on("context_updated", ({ groupId, userId }: { groupId: number; userId: number }) => {
  const payload = JSON.stringify({ type: "context_updated", groupId, userId });
  connections.get(groupId)?.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
});

contextBus.on("message_created", ({ groupId, message }: { groupId: number; message: unknown }) => {
  const payload = JSON.stringify({ type: "new_message", message });
  connections.get(groupId)?.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
});
