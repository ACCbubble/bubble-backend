import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ATTRIBUTE_DEFS, analyzeEventSetup } from "../lib/context.js";
import { createPollForEvent } from "../lib/pollWorkflows.js";

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

export async function demoRoutes(app: FastifyInstance) {
  // GET /demo — public endpoint returning the Demo event info for the demo screen
  app.get("/demo", async (_request, reply) => {
    const group = await prisma.group.findFirst({ where: { name: "Demo" } });
    if (!group) return reply.status(404).send({ error: "Demo not set up yet. Run: npx tsx prisma/demo-seed.ts" });

    const event = await prisma.event.findFirst({
      where: { groupId: group.id },
      orderBy: { createdAt: "asc" },
    });
    if (!event) return reply.status(404).send({ error: "Demo event not found" });

    return { groupId: group.id, eventId: event.id, eventName: event.name };
  });

  // POST /auth/demo-signup — register + auto-login + join Demo group in one step
  app.post("/auth/demo-signup", async (request, reply) => {
    const { name, phone, password } = request.body as {
      name: string;
      phone: string;
      password: string;
    };

    if (!name || !phone || !password) {
      return reply.status(400).send({ error: "name, phone, and password are required" });
    }

    const demoGroup = await prisma.group.findFirst({ where: { name: "Demo" } });
    if (!demoGroup) {
      return reply.status(404).send({ error: "Demo not set up yet. Run: npx tsx prisma/demo-seed.ts" });
    }

    const memberCount = await prisma.groupMember.count({ where: { groupId: demoGroup.id } });
    if (memberCount >= 8) {
      return reply.status(409).send({ error: "The demo is full (8 people max). Check back later!" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    let user: Prisma.UserGetPayload<object>;
    try {
      user = await prisma.user.create({ data: { name, phone, passwordHash } });
      await prisma.userAttribute.createMany({
        data: ATTRIBUTE_DEFS.map((a) => ({ userId: user.id, key: a.key, score: a.defaultScore })),
        skipDuplicates: true,
      });
    } catch {
      return reply.status(409).send({ error: "Phone number already registered" });
    }

    // Add new user to the Demo group
    await prisma.groupMember.upsert({
      where: { userId_groupId: { userId: user.id, groupId: demoGroup.id } },
      update: {},
      create: { userId: user.id, groupId: demoGroup.id, role: "member" },
    });

    // Issue auth cookies (same flow as /auth/login)
    const accessToken = app.jwt.sign(
      { userId: user.id, name: user.name, jti: crypto.randomUUID() },
      { expiresIn: ACCESS_TOKEN_TTL }
    );
    const rawRefresh = crypto.randomBytes(40).toString("hex");
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawRefresh),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    reply
      .setCookie("access_token", accessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 })
      .setCookie("refresh_token", rawRefresh, { ...COOKIE_OPTS, maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 });

    const event = await prisma.event.findFirst({
      where: { groupId: demoGroup.id },
      orderBy: { createdAt: "asc" },
    });

    return { id: user.id, name: user.name, groupId: demoGroup.id, eventId: event?.id ?? null };
  });

  // POST /demo/reset — wipe demo data and re-seed (requires DEMO_RESET_SECRET header)
  app.post("/demo/reset", async (request, reply) => {
    const secret = process.env.DEMO_RESET_SECRET;
    if (!secret) return reply.status(503).send({ error: "DEMO_RESET_SECRET not configured" });
    if (request.headers["x-demo-secret"] !== secret) {
      return reply.status(401).send({ error: "Invalid secret" });
    }

    // Delete existing demo group + all related data
    const colin = await prisma.user.findUnique({ where: { phone: "6199802813" } });
    if (colin) {
      const group = await prisma.group.findFirst({ where: { name: "Demo", creatorId: colin.id } });
      if (group) {
        const events = await prisma.event.findMany({ where: { groupId: group.id } });
        for (const ev of events) {
          const msgs = await prisma.message.findMany({ where: { eventId: ev.id } });
          for (const m of msgs) {
            await prisma.messageContextEvidence.deleteMany({ where: { messageId: m.id } });
          }
          const polls = await prisma.polls.findMany({ where: { event_id: ev.id } });
          for (const p of polls) {
            await prisma.votes.deleteMany({ where: { poll_id: p.id } });
            await prisma.options.deleteMany({ where: { poll_id: p.id } });
          }
          await prisma.polls.deleteMany({ where: { event_id: ev.id } });
          await prisma.message.deleteMany({ where: { eventId: ev.id } });
        }
        await prisma.event.deleteMany({ where: { groupId: group.id } });
        // Remove non-Colin members (keep Colin)
        await prisma.groupMember.deleteMany({ where: { groupId: group.id, userId: { not: colin.id } } });
        await prisma.group.delete({ where: { id: group.id } });
      }
    }

    // Re-seed
    const passwordHash = await bcrypt.hash("1234", 12);
    const colinUser = await prisma.user.upsert({
      where: { phone: "6199802813" },
      update: { name: "Colin", passwordHash },
      create: { name: "Colin", phone: "6199802813", passwordHash },
    });
    await prisma.userAttribute.createMany({
      data: ATTRIBUTE_DEFS.map((a) => ({ userId: colinUser.id, key: a.key, score: a.defaultScore })),
      skipDuplicates: true,
    });

    const group = await prisma.group.create({ data: { name: "Demo", creatorId: colinUser.id } });
    await prisma.groupMember.create({ data: { userId: colinUser.id, groupId: group.id, role: "admin" } });

    const initialMessage = "Let's get dinner after this presentation";
    let setupAnalysis;
    try {
      setupAnalysis = await analyzeEventSetup({ groupName: group.name, initialMessage });
    } catch { /* non-fatal */ }

    const event = await prisma.event.create({
      data: {
        groupId: group.id,
        creatorId: colinUser.id,
        name: "Dinner",
        ...(setupAnalysis?.extracted.location ? { location: setupAnalysis.extracted.location } : {}),
        ...(setupAnalysis?.extracted.eventTime ? { eventTime: new Date(setupAnalysis.extracted.eventTime) } : {}),
        ...(setupAnalysis?.extracted.description ? { description: setupAnalysis.extracted.description } : {}),
      },
    });

    const message = await prisma.message.create({
      data: { eventId: event.id, senderId: colinUser.id, content: initialMessage },
    });

    const comingEmoji = await prisma.emojiType.findUnique({ where: { name: "coming" } });
    if (comingEmoji) {
      await prisma.messageContextEvidence.create({
        data: { messageId: message.id, emojiTypeId: comingEmoji.id, confidence: 0.95, displayQuote: "Event Suggester" },
      });
    }

    if (setupAnalysis) {
      for (const fp of setupAnalysis.fieldPolls) {
        await createPollForEvent({
          eventId: event.id, userId: colinUser.id,
          question: fp.question, options: fp.options,
          setupField: fp.field,
          allowsSuggestions: fp.field === "description" || fp.options.length === 0,
          isAutoPoll: true,
        });
      }
      for (const qp of setupAnalysis.questionPolls) {
        await createPollForEvent({
          eventId: event.id, userId: colinUser.id,
          question: qp.question, options: qp.options.map((o) => ({ optionText: o })),
          allowsMultiple: qp.allowsMultiple, allowsSuggestions: true, isAutoPoll: true,
        });
      }
    }

    return { ok: true, groupId: group.id, eventId: event.id };
  });
}
