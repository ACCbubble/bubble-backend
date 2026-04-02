import { FastifyRequest, FastifyReply } from "fastify";

// Typed JWT payload — makes request.user available on all routes after jwtVerify()
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { userId: number; name: string; jti: string };
    user: { userId: number; name: string; jti: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
