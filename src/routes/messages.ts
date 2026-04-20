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

async function getPrimaryEvent(groupId: number): Promise<{ id: number; groupId: number } | null> {
  return prisma.event.findFirst({
    where: { groupId },
    orderBy: { createdAt: "asc" },
    select: { id: true, groupId: true },
  });
}

async function getEventById(eventId: number): Promise<{ id: number; groupId: number } | null> {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, groupId: true },
  });
}

async function createAutoPollAndChainMessage(input: {
  eventId: number;
  senderId: number;
  draft: PollDraft;
  isAutoPoll: boolean;
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
      options: {
        include: {
          votes: true,
        },
      },
    },
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
    eventId: input.eventId,
    message: {
      ...pollMessage,
      poll: formatPollState(poll, input.senderId),
      isAutoPoll: input.isAutoPoll,
    },
  });

  contextBus.emit("poll_updated", { eventId: input.eventId, pollId: poll.id });

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

async function fetchFeedMessagesByEvent(eventId: number) {
  return prisma.message.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    include: {
      sender: { select: { id: true, name: true } },
      viewerRelevance: true,
      contextEvidence: {
        where: { emojiTypeId: { not: null } },
        include: { emojiType: { select: { id: true, name: true, emoji: true } } },
      },
    },
  });
}

async function fetchFeedMessagesByGroup(groupId: number) {
  return prisma.message.findMany({
    where: { event: { groupId } },
    orderBy: { createdAt: "desc" },
    include: {
      sender: { select: { id: true, name: true } },
      viewerRelevance: true,
      contextEvidence: {
        where: { emojiTypeId: { not: null } },
        include: { emojiType: { select: { id: true, name: true, emoji: true } } },
      },
    },
  });
}

type FeedMessage = Awaited<ReturnType<typeof fetchFeedMessagesByEvent>>[number];

async function enrichFeedMessages(messages: FeedMessage[], viewerUserId?: number) {
  const pollIds = messages
    .map((message) => parsePollMessageId(message.content))
    .filter((pollId): pollId is number => Number.isInteger(pollId));

  const pollById = await buildPollMessageMap({ pollIds, viewerUserId });

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
}

function scoreFeedMessages(messages: Awaited<ReturnType<typeof enrichFeedMessages>>, attrMap: Record<string, number>, viewerName: string) {
  const LAMBDA = Math.LN2 / 48;

  function recency(createdAt: Date) {
    return Math.exp(-LAMBDA * (Date.now() - createdAt.getTime()) / 3_600_000);
  }

  const scored = messages.map((message) => {
    const contentLower = message.content.toLowerCase();
    let score = recency(message.createdAt) * 0.4;

    if (viewerName && (contentLower.includes(viewerName) || contentLower.includes(`@${viewerName}`))) {
      score += 2.0;
    }

    if (message.content.includes("?")) {
      score += 0.3;
    }

    for (const relevance of message.viewerRelevance) {
      const viewerScore = attrMap[relevance.attributeKey] ?? 0;
      score += viewerScore * relevance.score;
    }

    const { contextEvidence, viewerRelevance: _, ...rest } = message;
    const emojiSignals = contextEvidence
      .filter((evidence) => evidence.emojiType)
      .map((evidence) => ({
        emojiId: evidence.emojiType!.id,
        name: evidence.emojiType!.name,
        emoji: evidence.emojiType!.emoji,
        confidence: evidence.confidence,
      }));

    return { ...rest, relevanceScore: score, emojiSignals };
  });

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored;
}

async function fetchTimelineMessagesByEvent(eventId: number) {
  return prisma.message.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    include: { sender: true },
  });
}

async function fetchTimelineMessagesByGroup(groupId: number) {
  return prisma.message.findMany({
    where: { event: { groupId } },
    orderBy: { createdAt: "asc" },
    include: { sender: true },
  });
}

type TimelineMessage = Awaited<ReturnType<typeof fetchTimelineMessagesByEvent>>[number];

async function attachPolls(messages: TimelineMessage[], viewerUserId?: number) {
  const pollIds = messages
    .map((message) => parsePollMessageId(message.content))
    .filter((id): id is number => Number.isInteger(id));

  const pollById = await buildPollMessageMap({ pollIds, viewerUserId });

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
}

export async function messageRoutes(app: FastifyInstance) {
  app.post("/messages", async (request, reply) => {
    const { eventId, groupId, senderId, content } = request.body as {
      eventId?: number;
      groupId?: number;
      senderId: number;
      content: string;
    };

    const resolvedEventId =
      typeof eventId === "number" && Number.isInteger(eventId) && eventId > 0 ? eventId : null;
    const resolvedGroupId =
      typeof groupId === "number" && Number.isInteger(groupId) && groupId > 0 ? groupId : null;
    const hasEventId = resolvedEventId !== null;
    const hasGroupId = resolvedGroupId !== null;
    if (!hasEventId && !hasGroupId) {
      return reply.status(400).send({ error: "eventId or groupId is required" });
    }

    try {
      const event = hasEventId
        ? await getEventById(resolvedEventId as number)
        : await getPrimaryEvent(resolvedGroupId as number);
      if (!event) return reply.status(404).send({ error: "No event found for the provided scope" });

      const message = await prisma.message.create({
        data: { eventId: event.id, senderId, content },
        include: { sender: { select: { id: true, name: true } } },
      });

      await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: senderId, groupId: event.groupId } },
        update: {},
        create: { userId: senderId, groupId: event.groupId, role: "member" },
      });

      contextBus.emit("message_created", { eventId: event.id, message });

      processMessageContext(message.id, message.senderId, event.id, message.content)
        .then(async (pollDraft) => {
          if (!pollDraft) return;
          await createAutoPollAndChainMessage({
            eventId: event.id,
            senderId: message.senderId,
            draft: pollDraft,
            isAutoPoll: true,
          });
        })
        .catch(() => {});

      return message;
    } catch {
      reply.status(400).send({ error: "Message creation failed" });
    }
  });

  app.get("/events/:id/feed", { preHandler: [app.authenticate] }, async (request, reply) => {
    const eventId = Number((request.params as { id: string }).id);
    const { userId } = request.query as { userId?: string };
    if (!userId) return reply.status(400).send({ error: "userId required" });

    const uid = Number(userId);
    const viewer = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
    const viewerName = viewer?.name?.toLowerCase() ?? "";

    const attrs = await prisma.userAttribute.findMany({ where: { userId: uid } });
    const attrMap: Record<string, number> = {};
    for (const attr of attrs) attrMap[attr.key] = attr.score;

    const messages = await fetchFeedMessagesByEvent(eventId);
    const enriched = await enrichFeedMessages(messages, uid);
    return scoreFeedMessages(enriched, attrMap, viewerName);
  });

  app.get("/groups/:id/feed", { preHandler: [app.authenticate] }, async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const { userId } = request.query as { userId?: string };
    if (!userId) return reply.status(400).send({ error: "userId required" });

    const uid = Number(userId);
    const viewer = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
    const viewerName = viewer?.name?.toLowerCase() ?? "";

    const attrs = await prisma.userAttribute.findMany({ where: { userId: uid } });
    const attrMap: Record<string, number> = {};
    for (const attr of attrs) attrMap[attr.key] = attr.score;

    const messages = await fetchFeedMessagesByGroup(groupId);
    const enriched = await enrichFeedMessages(messages, uid);
    return scoreFeedMessages(enriched, attrMap, viewerName);
  });

  app.get("/events/:id/messages", async (request, reply) => {
    const eventId = Number((request.params as { id: string }).id);
    const { viewerUserId } = request.query as { viewerUserId?: string };
    const parsedViewerUserId = viewerUserId ? Number(viewerUserId) : undefined;

    try {
      const messages = await fetchTimelineMessagesByEvent(eventId);
      return attachPolls(messages, parsedViewerUserId);
    } catch {
      reply.status(400).send({ error: "Fetching messages failed" });
    }
  });

  app.get("/groups/:id/messages", async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const { viewerUserId } = request.query as { viewerUserId?: string };
    const parsedViewerUserId = viewerUserId ? Number(viewerUserId) : undefined;

    try {
      const messages = await fetchTimelineMessagesByGroup(groupId);
      return attachPolls(messages, parsedViewerUserId);
    } catch {
      reply.status(400).send({ error: "Fetching messages failed" });
    }
  });
}
