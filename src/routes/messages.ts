import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { PollDraft, processMessageContext } from "../lib/context.js";
import { contextBus } from "../lib/contextBroadcast.js";

const AUTO_POLL_PREFIX = "[AUTO_POLL:";

function parseAutoPollId(content: string): number | null {
  const match = content.match(/^\[AUTO_POLL:(\d+)\]/);
  if (!match) return null;
  return Number(match[1]);
}

// Returns the primary event for a group (first by creation time).
async function getPrimaryEvent(groupId: number): Promise<{ id: number; groupId: number } | null> {
  return prisma.event.findFirst({
    where: { groupId },
    orderBy: { createdAt: "asc" },
    select: { id: true, groupId: true },
  });
}

async function createAutoPollAndChainMessage(input: {
  eventId: number;
  groupId: number;
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
    include: { options: true },
  });

  const pollMessage = await prisma.message.create({
    data: {
      eventId: input.eventId,
      senderId: input.senderId,
      content: `${AUTO_POLL_PREFIX}${poll.id}] ${input.draft.question}`,
    },
    include: { sender: { select: { id: true, name: true } } },
  });

  contextBus.emit("message_created", {
    groupId: input.groupId,
    message: {
      ...pollMessage,
      poll: {
        id: poll.id,
        question: poll.question,
        allowsMultiple: poll.allows_multiple,
        options: poll.options.map((o) => ({ id: o.id, optionText: o.option_text })),
      },
      isAutoPoll: true,
    },
  });
}

export async function messageRoutes(app: FastifyInstance) {

  // ===============================
  // SEND MESSAGE
  // ===============================
  app.post("/messages", async (request, reply) => {
    const { groupId, senderId, content } = request.body as {
      groupId: number;
      senderId: number;
      content: string;
    };

    try {
      const event = await getPrimaryEvent(groupId);
      if (!event) return reply.status(404).send({ error: "No event found for group" });

      const message = await prisma.message.create({
        data: { eventId: event.id, senderId, content },
        include: { sender: { select: { id: true, name: true } } },
      });

      // Ensure sender is a group member (idempotent)
      await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: senderId, groupId } },
        update: {},
        create: { userId: senderId, groupId, role: "member" },
      });

      contextBus.emit("message_created", { groupId, message });

      processMessageContext(message.id, message.senderId, groupId, message.content)
        .then(async (pollDraft) => {
          if (!pollDraft) return;
          await createAutoPollAndChainMessage({
            eventId: event.id,
            groupId,
            senderId: message.senderId,
            draft: pollDraft,
          });
        })
        .catch(() => {});

      return message;
    } catch {
      reply.status(400).send({ error: "Message creation failed" });
    }
  });


  // ===============================
  // GET FEED — AI-sorted by relevance to the viewer
  // ===============================
  app.get("/groups/:id/feed", { preHandler: [app.authenticate] }, async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const { userId } = request.query as { userId?: string };
    if (!userId) return reply.status(400).send({ error: "userId required" });
    const uid = Number(userId);

    // Fetch viewer name for direct-mention detection
    const viewer = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
    const viewerName = viewer?.name?.toLowerCase() ?? "";

    // Fetch viewer's attribute scores — these are the weights in the dot product
    const attrs = await prisma.userAttribute.findMany({ where: { userId: uid } });
    const attrMap: Record<string, number> = {};
    for (const a of attrs) attrMap[a.key] = a.score;

    const messages = await prisma.message.findMany({
      where: { event: { groupId } },
      orderBy: { createdAt: "desc" },
      include: {
        sender: { select: { id: true, name: true } },
        // viewer relevance hashmap entries for this message
        viewerRelevance: true,
        // emoji evidence for display in the ring (not used for feed scoring)
        contextEvidence: {
          where: { emojiTypeId: { not: null } },
          include: { emojiType: { select: { id: true, name: true, emoji: true } } },
        },
      },
    });

    // 48-hour half-life recency decay
    const LAMBDA = Math.LN2 / 48;
    function recency(createdAt: Date) {
      return Math.exp(-LAMBDA * (Date.now() - createdAt.getTime()) / 3_600_000);
    }

    const scored = messages.map((msg) => {
      const contentLower = msg.content.toLowerCase();

      // Base: recency so messages never have score=0
      let score = recency(msg.createdAt) * 0.4;

      // Direct mention → very high relevance
      if (viewerName && (
        contentLower.includes(viewerName) ||
        contentLower.includes(`@${viewerName}`)
      )) {
        score += 2.0;
      }

      // Question boost
      if (msg.content.includes("?")) {
        score += 0.3;
      }

      // Dot product: Σ viewer_attr_score × message_attr_relevance_score
      for (const rel of msg.viewerRelevance) {
        const viewerScore = attrMap[rel.attributeKey] ?? 0;
        score += viewerScore * rel.score;
      }

      const { contextEvidence, viewerRelevance: _, ...rest } = msg;

      // Attach emoji signals for the client (display only)
      const emojiSignals = contextEvidence
        .filter(ev => ev.emojiType)
        .map(ev => ({
          emojiId: ev.emojiType!.id,
          name: ev.emojiType!.name,
          emoji: ev.emojiType!.emoji,
          confidence: ev.confidence,
        }));

      return { ...rest, relevanceScore: score, emojiSignals };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored;
  });


  // ===============================
  // GET MESSAGES — chronological
  // ===============================
  app.get("/groups/:id/messages", async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);

    try {
      const messages = await prisma.message.findMany({
        where: { event: { groupId } },
        orderBy: { createdAt: "asc" },
        include: { sender: true },
      });

      const pollIds = messages
        .map((m) => parseAutoPollId(m.content))
        .filter((id): id is number => Number.isInteger(id));

      const polls = pollIds.length === 0
        ? []
        : await prisma.polls.findMany({
            where: { id: { in: pollIds } },
            include: { options: true },
          });

      const pollById = new Map(polls.map((p) => [p.id, p]));

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
            options: poll.options.map((o) => ({ id: o.id, optionText: o.option_text })),
          },
        };
      });
    } catch {
      reply.status(400).send({ error: "Fetching messages failed" });
    }
  });
}
