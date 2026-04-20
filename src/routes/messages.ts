import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { PollDraft, processMessageContext } from "../lib/context.js";
import { contextBus } from "../lib/contextBroadcast.js";
import { formatPollState } from "../lib/polls.js";

const AUTO_POLL_PREFIX = "[AUTO_POLL:";

function parsePollMessageId(content: string): number | null {
  const match = content.match(/^\[AUTO_POLL:(\d+)\]/);
  if (!match) return null;
  return Number(match[1]);
}

async function createPollAndChainMessage(input: {
  groupId: number;
  senderId: number;
  draft: PollDraft;
  isAutoPoll: boolean;
}) {
  const poll = await prisma.polls.create({
    data: {
      group_id: input.groupId,
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
      groupId: input.groupId,
      senderId: input.senderId,
      content: `${AUTO_POLL_PREFIX}${poll.id}] ${poll.question}`,
    },
    include: {
      sender: { select: { id: true, name: true } },
    },
  });

  contextBus.emit("message_created", {
    groupId: input.groupId,
    message: {
      ...pollMessage,
      poll: formatPollState({
        ...poll,
        options: poll.options.map((option) => ({ ...option, votes: [] })),
      }),
      isAutoPoll: input.isAutoPoll,
    },
  });

  return poll;
}

async function buildPollMessageMap(input: {
  pollIds: number[];
  viewerUserId?: number;
}) {
  if (input.pollIds.length === 0) return new Map<number, ReturnType<typeof formatPollState>>();

  const polls = await prisma.polls.findMany({
    where: { id: { in: input.pollIds } },
    include: {
      options: {
        include: {
          votes: true,
        },
      },
    },
  });

  return new Map(
    polls.map((poll) => [poll.id, formatPollState(poll, input.viewerUserId)]),
  );
}

export async function messageRoutes(app: FastifyInstance) {

  // ===============================
  // SEND MESSAGE
  // ===============================
  // Creates a new message in a group (conversation)
  app.post("/messages", async (request, reply) => {
    const { groupId, senderId, content } = request.body as {
      groupId: number;
      senderId: number;
      content: string;
    };

    try {
      const message = await prisma.message.create({
        data: { groupId, senderId, content },
        include: { sender: { select: { id: true, name: true } } },
      });

      // Ensure sender is a group member (idempotent)
      await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: senderId, groupId } },
        update: {},
        create: { userId: senderId, groupId, role: "member" },
      });

      // Broadcast new message to group WebSocket clients
      contextBus.emit('message_created', { groupId, message })

      // Fire context processing async — does not block the response
      processMessageContext(message.id, message.senderId, message.groupId, message.content)
        .then(async (pollDraft) => {
          if (!pollDraft) return;
          await createPollAndChainMessage({
            groupId: message.groupId,
            senderId: message.senderId,
            draft: pollDraft,
            isAutoPoll: true,
          });
        })
        .catch(() => {});

      return message;
    } catch (error) {
      reply.status(400).send({ error: "Message creation failed" });
    }
  });


  // ===============================
  // GET FEED (AI-sorted by viewer relevance)
  // ===============================
  // Returns messages sorted by relevance to a specific viewer based on their attributes.
  // Relevance: high has_car → needs_ride signals matter; dietary restriction → bringing_food matters, etc.
  app.get("/groups/:id/feed", { preHandler: [app.authenticate] }, async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const { userId } = request.query as { userId?: string };
    if (!userId) return reply.status(400).send({ error: "userId required" });
    const uid = Number(userId);

    const attrs = await prisma.userAttribute.findMany({ where: { userId: uid } });
    const attrMap: Record<string, number> = {};
    for (const a of attrs) attrMap[a.key] = a.score;

    const messages = await prisma.message.findMany({
      where: { groupId },
      orderBy: { createdAt: "desc" },
      include: {
        sender: { select: { id: true, name: true } },
        contextEvidence: {
          where: { emojiTypeId: { not: null } },
          include: { emojiType: { select: { name: true } } },
        },
      },
    });

    const pollIds = messages
      .map((message) => parsePollMessageId(message.content))
      .filter((pollId): pollId is number => Number.isInteger(pollId));

    const pollById = await buildPollMessageMap({
      pollIds,
      viewerUserId: uid,
    });

    const LAMBDA = Math.LN2 / 48; // 48h half-life for recency
    function recency(createdAt: Date) {
      return Math.exp(-LAMBDA * (Date.now() - createdAt.getTime()) / 3_600_000);
    }
    // Cross-relevance: how much does this emoji type matter to THIS viewer?
    function emojiRelevance(emojiName: string): number {
      switch (emojiName) {
        case "needs_ride":    return attrMap["has_car"] ?? 0;
        case "bringing_food": return attrMap["has_dietary_restriction"] ?? 0;
        case "coming":        return 1.0;
        default:              return 0.5;
      }
    }

    const scored = messages.map((msg) => {
      let relevanceScore = 0;
      for (const ev of msg.contextEvidence) {
        if (!ev.emojiType) continue;
        relevanceScore += emojiRelevance(ev.emojiType.name) * ev.confidence * recency(msg.createdAt);
      }
      const { contextEvidence: _, ...rest } = msg;
      const pollId = parsePollMessageId(msg.content);
      const poll = pollId ? pollById.get(pollId) : null;

      if (!poll) return { ...rest, relevanceScore };

      return {
        ...rest,
        relevanceScore,
        isAutoPoll: true,
        poll,
      };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored;
  });

  // ===============================
  // GET MESSAGES
  // ===============================
  // Fetch all messages for a group
  app.get("/groups/:id/messages", async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const { viewerUserId } = request.query as { viewerUserId?: string };
    const parsedViewerUserId = viewerUserId ? Number(viewerUserId) : undefined;

    try {
      const messages = await prisma.message.findMany({
        where: { groupId },
        orderBy: { createdAt: "asc" },
        include: {
          sender: true, // include sender info (name, etc.)
        },
      });

      const pollIds = messages
        .map((message) => parsePollMessageId(message.content))
        .filter((pollId): pollId is number => Number.isInteger(pollId));

      const pollById = await buildPollMessageMap({
        pollIds,
        viewerUserId: parsedViewerUserId,
      });

      return messages.map((message) => {
        const pollId = parsePollMessageId(message.content);
        const poll = pollId ? pollById.get(pollId) : null;

        if (!poll) return message;

        return {
          ...message,
          isAutoPoll: true,
          poll,
        };
      });
    } catch (error) {
      reply.status(400).send({ error: "Fetching messages failed" });
    }
  });
}
