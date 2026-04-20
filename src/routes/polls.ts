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
  options: Array<{ id: number; option_text: string | null }>;
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
    options: poll.options.map((option) => ({
      id: option.id,
      optionText: option.option_text,
    })),
  };
}

export async function pollRoutes(app: FastifyInstance) {
  app.post("/groups/:groupId/polls", async (request, reply) => {
    const groupId = Number((request.params as { groupId: string }).groupId);
    const { userId, question, options, expiresAt, allowsMultiple } = request.body as {
      userId: number;
      question: string;
      options: string[];
      expiresAt?: string;
      allowsMultiple?: boolean;
    };

    if (!Number.isInteger(groupId) || groupId <= 0) {
      return reply.status(400).send({ error: "Invalid groupId" });
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      return reply.status(400).send({ error: "Invalid userId" });
    }

    if (!question || question.trim().length === 0) {
      return reply.status(400).send({ error: "Question is required" });
    }

    if (
      !Array.isArray(options) ||
      options.length < 2 ||
      options.some((option) => typeof option !== "string" || option.trim().length === 0)
    ) {
      return reply.status(400).send({
        error: "Options must be an array of at least 2 non-empty strings",
      });
    }

    let parsedExpiresAt: Date | null = null;
    if (expiresAt) {
      parsedExpiresAt = new Date(expiresAt);
      if (Number.isNaN(parsedExpiresAt.getTime())) {
        return reply.status(400).send({ error: "expiresAt must be a valid date" });
      }
    }

    try {
      const poll = await prisma.polls.create({
        data: {
          event_id: groupId,
          user_id: userId,
          question: question.trim(),
          created_at: new Date(),
          expires_at: parsedExpiresAt,
          is_active: true,
          allows_multiple: allowsMultiple ?? false,
          options: {
            create: options.map((optionText) => ({ option_text: optionText.trim() })),
          },
        },
        include: {
          options: true,
        },
      });

      return reply.status(201).send({
        status: "OK",
        pollId: poll.id,
        results: `/polls/${poll.id}/results`,
        poll: formatPoll(poll),
      });
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({
        error: "Poll creation failed",
        details: String(error),
      });
    }
  });

  app.get("/groups/:groupId/polls", async (request, reply) => {
    const groupId = Number((request.params as { groupId: string }).groupId);

    if (!Number.isInteger(groupId) || groupId <= 0) {
      return reply.status(400).send({ error: "Invalid groupId" });
    }

    try {
      const events = await prisma.event.findMany({ where: { groupId }, select: { id: true } });
      const eventIds = events.map(e => e.id);
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
