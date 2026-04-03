import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

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
      const poll = await prisma.poll.create({
        data: {
          groupId,
          userId,
          question: question.trim(),
          created_at: new Date(),
          expiresAt: parsedExpiresAt,
          isActive: true,
          allowsMultiple: allowsMultiple ?? false,
          options: {
            create: options.map((optionText) => ({
              optionText: optionText.trim(),
            })),
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
        poll: {
          id: poll.id,
          groupId: poll.groupId,
          userId: poll.userId,
          question: poll.question,
          createdAt: poll.created_at,
          expiresAt: poll.expiresAt,
          isActive: poll.isActive,
          allowsMultiple: poll.allowsMultiple,
          options: poll.options.map((option) => ({
            id: option.id,
            optionText: option.optionText,
          })),
        },
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
      const polls = await prisma.poll.findMany({
        where: { groupId },
        orderBy: { id: "desc" },
        include: {
          options: true,
        },
      });

      return polls.map((poll) => ({
        pollId: poll.id,
        question: poll.question,
        createdAt: poll.created_at,
        expiresAt: poll.expiresAt,
        isActive: poll.isActive,
        allowsMultiple: poll.allowsMultiple,
        options: poll.options.map((option) => ({
          optionId: option.id,
          optionText: option.optionText,
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
      const poll = await prisma.poll.findUnique({
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
        expiresAt: poll.expiresAt,
        isActive: poll.isActive,
        allowsMultiple: poll.allowsMultiple,
        totalVotes: poll.votes.length,
        options: poll.options.map((option) => ({
          optionId: option.id,
          optionText: option.optionText,
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
      const poll = await prisma.poll.findUnique({
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

      if (poll.isActive === false) {
        return reply.status(400).send({ error: "Poll is no longer active" });
      }

      if (poll.expiresAt && new Date(poll.expiresAt) < new Date()) {
        return reply.status(400).send({ error: "Poll has expired" });
      }

      const existingVote = await prisma.vote.findFirst({
        where: {
          pollId,
          userId,
        },
      });

      let vote;

      if (existingVote) {
        vote = await prisma.vote.update({
          where: { id: existingVote.id },
          data: {
            optionId,
            createdAt: new Date(),
          },
        });
      } else {
        vote = await prisma.vote.create({
          data: {
            pollId,
            userId,
            optionId,
            createdAt: new Date(),
          },
        });
      }

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