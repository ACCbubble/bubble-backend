import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { PollDraft, processMessageContext } from "../lib/context.js";
import { contextBus } from "../lib/contextBroadcast.js";
import { findEventWithAccess } from "../lib/access.js";

const AUTO_POLL_PREFIX = "[AUTO_POLL:";

function parseAutoPollId(content: string): number | null {
  const match = content.match(/^\[AUTO_POLL:(\d+)\]/);
  if (!match) return null;
  return Number(match[1]);
}

async function createAutoPollAndChainMessage(input: {
  eventId: number;
  senderId: number;
  draft: PollDraft;
}) {
  const poll = await prisma.polls.create({
    data: {
      event_id: input.eventId,
      user_id: input.senderId,
      question: input.draft.question,
      created_at: new Date(),
      is_active: true,
      allows_multiple: input.draft.allowsMultiple,
      options: {
        create: input.draft.options.map((optionText) => ({ option_text: optionText })),
      },
    },
    include: {
      options: true,
    },
  });

  const pollMessage = await prisma.message.create({
    data: {
      eventId: input.eventId,
      senderId: input.senderId,
      content: `${AUTO_POLL_PREFIX}${poll.id}] ${poll.question}`,
    },
    include: {
      sender: { select: { id: true, name: true } },
    },
  });

  contextBus.emit("message_created", {
    eventId: input.eventId,
    message: {
      ...pollMessage,
      poll: {
        id: poll.id,
        question: poll.question,
        allowsMultiple: poll.allows_multiple,
        options: poll.options.map((option) => ({
          id: option.id,
          optionText: option.option_text,
        })),
      },
      isAutoPoll: true,
    },
  });
}

export async function messageRoutes(app: FastifyInstance) {
  app.post("/events/:id/messages", { preHandler: [app.authenticate] }, async (request, reply) => {
    const eventId = Number((request.params as { id: string }).id);
    const senderId = request.user.userId;
    const { content } = request.body as { content: string };

    const event = await findEventWithAccess(eventId, senderId);
    if (!event) return reply.status(404).send({ error: "Event not found" });

    try {
      const message = await prisma.message.create({
        data: { eventId, senderId, content },
        include: { sender: { select: { id: true, name: true } } },
      });

      contextBus.emit("message_created", { eventId, message });

      processMessageContext(message.id, message.senderId, message.eventId, message.content)
        .then(async (pollDraft) => {
          if (!pollDraft) return;
          await createAutoPollAndChainMessage({
            eventId: message.eventId,
            senderId: message.senderId,
            draft: pollDraft,
          });
        })
        .catch(() => {});

      return message;
    } catch {
      return reply.status(400).send({ error: "Message creation failed" });
    }
  });

  app.get("/events/:id/feed", { preHandler: [app.authenticate] }, async (request, reply) => {
    const eventId = Number((request.params as { id: string }).id);
    const viewerId = request.user.userId;

    const event = await findEventWithAccess(eventId, viewerId);
    if (!event) return reply.status(404).send({ error: "Event not found" });

    const attrs = await prisma.userAttribute.findMany({ where: { userId: viewerId } });
    const attrMap: Record<string, number> = {};
    for (const a of attrs) attrMap[a.key] = a.score;

    const messages = await prisma.message.findMany({
      where: { eventId },
      orderBy: { createdAt: "desc" },
      include: {
        sender: { select: { id: true, name: true } },
        contextEvidence: {
          where: { emojiTypeId: { not: null } },
          include: { emojiType: { select: { name: true } } },
        },
      },
    });

    const LAMBDA = Math.LN2 / 48;
    function recency(createdAt: Date) {
      return Math.exp((-LAMBDA * (Date.now() - createdAt.getTime())) / 3_600_000);
    }

    function emojiRelevance(emojiName: string): number {
      switch (emojiName) {
        case "needs_ride":
          return attrMap["has_car"] ?? 0;
        case "bringing_food":
          return attrMap["has_dietary_restriction"] ?? 0;
        case "coming":
          return 1.0;
        default:
          return 0.5;
      }
    }

    const scored = messages.map((msg) => {
      let relevanceScore = 0;
      for (const ev of msg.contextEvidence) {
        if (!ev.emojiType) continue;
        relevanceScore += emojiRelevance(ev.emojiType.name) * ev.confidence * recency(msg.createdAt);
      }
      const { contextEvidence: _, ...rest } = msg;
      return { ...rest, relevanceScore };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored;
  });

  app.get("/events/:id/messages", { preHandler: [app.authenticate] }, async (request, reply) => {
    const eventId = Number((request.params as { id: string }).id);
    const userId = request.user.userId;

    const event = await findEventWithAccess(eventId, userId);
    if (!event) return reply.status(404).send({ error: "Event not found" });

    try {
      const messages = await prisma.message.findMany({
        where: { eventId },
        orderBy: { createdAt: "asc" },
        include: {
          sender: true,
        },
      });

      const pollIds = messages
        .map((message) => parseAutoPollId(message.content))
        .filter((pollId): pollId is number => Number.isInteger(pollId));

      const polls =
        pollIds.length === 0
          ? []
          : await prisma.polls.findMany({
              where: { id: { in: pollIds } },
              include: { options: true },
            });

      const pollById = new Map(polls.map((poll) => [poll.id, poll]));

      return messages.map((message) => {
        const pollId = parseAutoPollId(message.content);
        const poll = pollId ? pollById.get(pollId) : null;

        if (!poll) return message;

        return {
          ...message,
          isAutoPoll: true,
          poll: {
            id: poll.id,
            question: poll.question,
            createdAt: poll.created_at,
            expiresAt: poll.expires_at,
            isActive: poll.is_active,
            allowsMultiple: poll.allows_multiple,
            options: poll.options.map((option) => ({
              id: option.id,
              optionText: option.option_text,
            })),
          },
        };
      });
    } catch {
      return reply.status(400).send({ error: "Fetching messages failed" });
    }
  });
}
