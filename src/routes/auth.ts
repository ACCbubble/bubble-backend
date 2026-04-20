import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { revokeJti } from "../lib/tokenRevocation.js";
import { ATTRIBUTE_DEFS } from "../lib/context.js";

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const isProd = process.env.NODE_ENV === "production";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: isProd ? "none" : "strict",
  path: "/",
  secure: isProd,
} as const;

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/register
  app.post("/auth/register", async (request, reply) => {
    const { name, phone, password } = request.body as {
      name: string;
      phone: string;
      password: string;
    };

    if (!name || !phone || !password) {
      return reply
        .status(400)
        .send({ error: "name, phone, and password are required" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    try {
      const user = await prisma.user.create({
        data: { name, phone, passwordHash },
      });
      // Seed default attribute scores for new user
      await prisma.userAttribute.createMany({
        data: ATTRIBUTE_DEFS.map(a => ({ userId: user.id, key: a.key, score: a.defaultScore })),
        skipDuplicates: true,
      })

      return reply
        .status(201)
        .send({ id: user.id, name: user.name, phone: user.phone });
    } catch {
      return reply
        .status(409)
        .send({ error: "Phone number already registered" });
    }
  });

  // POST /auth/login
  app.post("/auth/login", async (request, reply) => {
    const { phone, password } = request.body as {
      phone: string;
      password: string;
    };

    const user = await prisma.user.findUnique({ where: { phone } });
    // Compare even on missing user to prevent timing attacks
    const hash = user?.passwordHash ?? "$2b$12$invalidhashpaddingtomatch";
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const accessToken = app.jwt.sign(
      { userId: user.id, name: user.name, jti: crypto.randomUUID() },
      { expiresIn: ACCESS_TOKEN_TTL }
    );

    const rawRefresh = crypto.randomBytes(40).toString("hex");
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000
    );
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawRefresh),
        expiresAt,
      },
    });

    reply
      .setCookie("access_token", accessToken, {
        ...COOKIE_OPTS,
        maxAge: 15 * 60,
      })
      .setCookie("refresh_token", rawRefresh, {
        ...COOKIE_OPTS,
        maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60,
      });

    return { id: user.id, name: user.name };
  });

  // POST /auth/refresh — silent token rotation, called automatically by frontend on 401
  app.post("/auth/refresh", async (request, reply) => {
    const rawRefresh = (request.cookies as Record<string, string>)
      ?.refresh_token;
    if (!rawRefresh) {
      return reply.status(401).send({ error: "No refresh token" });
    }

    const stored = await prisma.refreshToken.findFirst({
      where: {
        tokenHash: hashToken(rawRefresh),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!stored) {
      return reply
        .status(401)
        .send({ error: "Invalid or expired refresh token" });
    }

    // Rotate: revoke old token, issue new pair
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const newRawRefresh = crypto.randomBytes(40).toString("hex");
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000
    );
    await prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashToken(newRawRefresh),
        expiresAt,
      },
    });

    const accessToken = app.jwt.sign(
      { userId: stored.userId, name: stored.user.name, jti: crypto.randomUUID() },
      { expiresIn: ACCESS_TOKEN_TTL }
    );

    reply
      .setCookie("access_token", accessToken, {
        ...COOKIE_OPTS,
        maxAge: 15 * 60,
      })
      .setCookie("refresh_token", newRawRefresh, {
        ...COOKIE_OPTS,
        maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60,
      });

    return { ok: true };
  });

  // GET /auth/me — requires valid access_token cookie
  app.get(
    "/auth/me",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { userId, name } = request.user as { userId: number; name: string };
      return { userId, name };
    }
  );

  // DELETE /auth/logout
  app.delete("/auth/logout", async (request, reply) => {
    const cookies = request.cookies as Record<string, string>;

    // Revoke the access token JTI immediately so it's rejected even if cookie persists
    const rawAccess = cookies?.access_token;
    if (rawAccess) {
      const decoded = app.jwt.decode<{ jti?: string; exp?: number }>(rawAccess);
      if (decoded?.jti && decoded?.exp) {
        revokeJti(decoded.jti, decoded.exp * 1000);
      }
    }

    // Revoke the refresh token in DB
    const rawRefresh = cookies?.refresh_token;
    if (rawRefresh) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawRefresh), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    reply
      .clearCookie("access_token", { ...COOKIE_OPTS })
      .clearCookie("refresh_token", { ...COOKIE_OPTS });

    return { ok: true };
  });
}
