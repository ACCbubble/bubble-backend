import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";

import { healthRoutes } from "./routes/health.js";
import { userRoutes } from "./routes/users.js";
import { groupRoutes } from "./routes/groups.js";
import { groupMemberRoutes } from "./routes/groupMembers.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: "http://localhost:5173",
});
await app.register(helmet);
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