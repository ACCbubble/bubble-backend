import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

function formatPoll(poll: {
  id: number;
  event_id: number | null;
  user_id: number | null;
  question: string | null;
  created_at: Date | null;
  expires_at: Date | null;
  is_active: boolean | null;
  allows_multiple: boolean | null;
  options?: Array<{ id: number; option_text: string | null }>;
}) {
  return {
    id: poll.id,
    eventId: poll.event_id,
    userId: poll.user_id,
    question: poll.question,
    createdAt: poll.created_at,
    expiresAt: poll.expires_at,
    isActive: poll.is_active,
    allowsMultiple: poll.allows_multiple,
    options: (poll.options ?? []).map((option) => ({
      id: option.id,
      optionText: option.option_text,
    })),
  };
}

interface CreatePollPayload {
  userId: number;
  question: string;
  options: string[];
  expiresAt?: string;
  allowsMultiple?: boolean;
}

interface NormalizedPollPayload {
  userId: number;
  question: string;
  options: string[];
  parsedExpiresAt: Date | null;
  allowsMultiple: boolean;
}

async function getPrimaryEventId(groupId: number): Promise<number | null> {
  const event = await prisma.event.findFirst({
    where: { groupId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return event?.id ?? null;
}

function normalizePollPayload(payload: CreatePollPayload): { error: string } | { value: NormalizedPollPayload } {
  if (!Number.isInteger(payload.userId) || payload.userId <= 0) {
    return { error: "Invalid userId" } as const;
  }

  if (!payload.question || payload.question.trim().length === 0) {
    return { error: "Question is required" } as const;
  }

  if (
    !Array.isArray(payload.options) ||
    payload.options.length < 2 ||
    payload.options.some((option) => typeof option !== "string" || option.trim().length === 0)
  ) {
    return { error: "Options must be an array of at least 2 non-empty strings" } as const;
  }

  let parsedExpiresAt: Date | null = null;
  if (payload.expiresAt) {
    parsedExpiresAt = new Date(payload.expiresAt);
    if (Number.isNaN(parsedExpiresAt.getTime())) {
      return { error: "expiresAt must be a valid date" } as const;
    }
  }

  return {
    value: {
      userId: payload.userId,
      question: payload.question.trim(),
      options: payload.options.map((option) => option.trim()),
      parsedExpiresAt,
      allowsMultiple: payload.allowsMultiple ?? false,
    },
  } as const;
}

type CreatedPoll = Awaited<ReturnType<typeof prisma.polls.create>>;

async function createPollForEvent(
  eventId: number,
  payload: CreatePollPayload
): Promise<{ error: string } | { poll: CreatedPoll }> {
  const normalized = normalizePollPayload(payload);
  if ("error" in normalized) return normalized;

  const poll = await prisma.polls.create({
    data: {
      event_id: eventId,
      user_id: normalized.value.userId,
      question: normalized.value.question,
      created_at: new Date(),
      expires_at: normalized.value.parsedExpiresAt,
      is_active: true,
      allows_multiple: normalized.value.allowsMultiple,
      options: {
        create: normalized.value.options.map((optionText) => ({ option_text: optionText })),
      },
    },
    include: { options: true },
  });

  return { poll } as const;
}

export async function pollRoutes(app: FastifyInstance) {
  app.post("/events/:eventId/polls", async (request, reply) => {
    const eventId = Number((request.params as { eventId: string }).eventId);
    const payload = request.body as CreatePollPayload;

    if (!Number.isInteger(eventId) || eventId <= 0) {
      return reply.status(400).send({ error: "Invalid eventId" });
    }

    try {
      const result = await createPollForEvent(eventId, payload);
      if ("error" in result) {
        return reply.status(400).send({ error: result.error });
      }

      return reply.status(201).send({
        status: "OK",
        pollId: result.poll.id,
        results: `/polls/${result.poll.id}/results`,
        poll: formatPoll(result.poll),
      });
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({
        error: "Poll creation failed",
        details: String(error),
      });
    }
  });

  app.post("/groups/:groupId/polls", async (request, reply) => {
    const groupId = Number((request.params as { groupId: string }).groupId);
    const payload = request.body as CreatePollPayload;

    if (!Number.isInteger(groupId) || groupId <= 0) {
      return reply.status(400).send({ error: "Invalid groupId" });
    }

    const eventId = await getPrimaryEventId(groupId);
    if (!eventId) {
      return reply.status(404).send({ error: "No event found for group" });
    }

    try {
      const result = await createPollForEvent(eventId, payload);
      if ("error" in result) {
        return reply.status(400).send({ error: result.error });
      }

      return reply.status(201).send({
        status: "OK",
        pollId: result.poll.id,
        results: `/polls/${result.poll.id}/results`,
        poll: formatPoll(result.poll),
      });
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({
        error: "Poll creation failed",
        details: String(error),
      });
    }
  });

  app.get("/events/:eventId/polls", async (request, reply) => {
    const eventId = Number((request.params as { eventId: string }).eventId);

    if (!Number.isInteger(eventId) || eventId <= 0) {
      return reply.status(400).send({ error: "Invalid eventId" });
    }

    try {
      const polls = await prisma.polls.findMany({
        where: { event_id: eventId },
        orderBy: { id: "desc" },
        include: { options: true },
      });

      return polls.map((poll) => ({
        pollId: poll.id,
        question: poll.question,
        createdAt: poll.created_at,
        expiresAt: poll.expires_at,
        isActive: poll.is_active,
        allowsMultiple: poll.allows_multiple,
        options: poll.options.map((option) => ({
          optionId: option.id,
          optionText: option.option_text,
        })),
        results: `/polls/${poll.id}/results`,
      }));
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Failed to fetch polls" });
    }
  });

  app.get("/groups/:groupId/polls", async (request, reply) => {
    const groupId = Number((request.params as { groupId: string }).groupId);

    if (!Number.isInteger(groupId) || groupId <= 0) {
      return reply.status(400).send({ error: "Invalid groupId" });
    }

    try {
      const events = await prisma.event.findMany({ where: { groupId }, select: { id: true } });
      const eventIds = events.map((event) => event.id);
      const polls = await prisma.polls.findMany({
        where: { event_id: { in: eventIds } },
        orderBy: { id: "desc" },
        include: { options: true },
      });

      return polls.map((poll) => ({
        pollId: poll.id,
        question: poll.question,
        createdAt: poll.created_at,
        expiresAt: poll.expires_at,
        isActive: poll.is_active,
        allowsMultiple: poll.allows_multiple,
        options: poll.options.map((option) => ({
          optionId: option.id,
          optionText: option.option_text,
        })),
        results: `/polls/${poll.id}/results`,
      }));
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Failed to fetch polls" });
    }
  });

  app.get("/polls/:pollId/results", async (request, reply) => {
    const pollId = Number((request.params as { pollId: string }).pollId);

    if (!Number.isInteger(pollId) || pollId <= 0) {
      return reply.status(400).send({ error: "Invalid pollId" });
    }

    try {
      const poll = await prisma.polls.findUnique({
        where: { id: pollId },
        include: {
          options: {
            include: {
              votes: true,
            },
          },
          votes: true,
        },
      });

      if (!poll) {
        return reply.status(404).send({ error: "Poll not found" });
      }

      return {
        pollId: poll.id,
        question: poll.question,
        createdAt: poll.created_at,
        expiresAt: poll.expires_at,
        isActive: poll.is_active,
        allowsMultiple: poll.allows_multiple,
        totalVotes: poll.votes.length,
        options: poll.options.map((option) => ({
          optionId: option.id,
          optionText: option.option_text,
          voteCount: option.votes.length,
        })),
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Failed to fetch poll results" });
    }
  });

  app.post("/polls/:pollId/votes", async (request, reply) => {
    const pollId = Number((request.params as { pollId: string }).pollId);
    const { userId, optionId } = request.body as {
      userId: number;
      optionId: number;
    };

    if (!Number.isInteger(pollId) || pollId <= 0) {
      return reply.status(400).send({ error: "Invalid pollId" });
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      return reply.status(400).send({ error: "Invalid userId" });
    }

    if (!Number.isInteger(optionId) || optionId <= 0) {
      return reply.status(400).send({ error: "Invalid optionId" });
    }

    try {
      const poll = await prisma.polls.findUnique({
        where: { id: pollId },
        include: {
          options: true,
        },
      });

      if (!poll) {
        return reply.status(404).send({ error: "Poll not found" });
      }

      const validOption = poll.options.find((option) => option.id === optionId);
      if (!validOption) {
        return reply.status(400).send({ error: "Option does not belong to this poll" });
      }

      if (poll.is_active === false) {
        return reply.status(400).send({ error: "Poll is no longer active" });
      }

      if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
        return reply.status(400).send({ error: "Poll has expired" });
      }

      const existingVote = await prisma.votes.findFirst({
        where: {
          poll_id: pollId,
          user_id: userId,
        },
      });

      const vote = existingVote
        ? await prisma.votes.update({
            where: { id: existingVote.id },
            data: {
              option_id: optionId,
              created_at: new Date(),
            },
          })
        : await prisma.votes.create({
            data: {
              poll_id: pollId,
              user_id: userId,
              option_id: optionId,
              created_at: new Date(),
            },
          });

      return {
        status: "OK",
        vote,
        results: `/polls/${pollId}/results`,
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Vote submission failed" });
    }
  });
}
