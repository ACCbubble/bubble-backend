import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { contextBus } from "../lib/contextBroadcast.js";
import { formatPollState, normalizeVoteSelection } from "../lib/polls.js";

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
          group_id: groupId,
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
          options: {
            include: {
              votes: true,
            },
          },
        },
      });

      await prisma.message.create({
        data: {
          groupId,
          senderId: userId,
          content: `[AUTO_POLL:${poll.id}] ${poll.question}`,
        },
      });

      contextBus.emit("poll_updated", { groupId, pollId: poll.id });

      return reply.status(201).send({
        status: "OK",
        pollId: poll.id,
        results: `/polls/${poll.id}/results`,
        poll: formatPollState(poll, userId),
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
      const polls = await prisma.polls.findMany({
        where: { group_id: groupId },
        orderBy: { id: "desc" },
        include: {
          options: {
            include: {
              votes: true,
            },
          },
        },
      });

      return polls.map((poll) => formatPollState(poll));
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Failed to fetch polls" });
    }
  });

  app.get("/polls/:pollId/results", async (request, reply) => {
    const pollId = Number((request.params as { pollId: string }).pollId);
    const { userId } = request.query as { userId?: string };
    const viewerUserId = userId ? Number(userId) : undefined;

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
        },
      });

      if (!poll) {
        return reply.status(404).send({ error: "Poll not found" });
      }

      return formatPollState(poll, viewerUserId);
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Failed to fetch poll results" });
    }
  });

  app.post("/polls/:pollId/votes", async (request, reply) => {
    const pollId = Number((request.params as { pollId: string }).pollId);
    const { userId, optionId, optionIds } = request.body as {
      userId: number;
      optionId?: number;
      optionIds?: number[];
    };

    if (!Number.isInteger(pollId) || pollId <= 0) {
      return reply.status(400).send({ error: "Invalid pollId" });
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      return reply.status(400).send({ error: "Invalid userId" });
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

      if (poll.is_active === false) {
        return reply.status(400).send({ error: "Poll is no longer active" });
      }

      if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
        return reply.status(400).send({ error: "Poll has expired" });
      }

      let selectedOptionIds: number[]
      try {
        selectedOptionIds = normalizeVoteSelection({
          allowsMultiple: Boolean(poll.allows_multiple),
          optionId,
          optionIds,
        })
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message })
      }

      const invalidOptionId = selectedOptionIds.find(
        (selectedId) => !poll.options.some((option) => option.id === selectedId),
      )
      if (invalidOptionId) {
        return reply.status(400).send({ error: "Option does not belong to this poll" });
      }

      const existingVotes = await prisma.votes.findMany({
        where: {
          poll_id: pollId,
          user_id: userId,
        },
      });

      const existingByOptionId = new Map(
        existingVotes
          .filter((vote) => typeof vote.option_id === "number")
          .map((vote) => [vote.option_id as number, vote]),
      );

      const toDelete = existingVotes
        .filter((vote) => typeof vote.option_id === "number" && !selectedOptionIds.includes(vote.option_id))
        .map((vote) => vote.id);

      const toCreate = selectedOptionIds.filter((selectedId) => !existingByOptionId.has(selectedId));
      const toRefresh = selectedOptionIds
        .map((selectedId) => existingByOptionId.get(selectedId))
        .filter((vote): vote is NonNullable<typeof vote> => Boolean(vote));

      await prisma.$transaction([
        ...(toDelete.length > 0 ? [prisma.votes.deleteMany({ where: { id: { in: toDelete } } })] : []),
        ...toRefresh.map((vote) =>
          prisma.votes.update({
            where: { id: vote.id },
            data: { created_at: new Date() },
          }),
        ),
        ...toCreate.map((selectedId) =>
          prisma.votes.create({
            data: {
              poll_id: pollId,
              user_id: userId,
              option_id: selectedId,
              created_at: new Date(),
            },
          }),
        ),
      ]);

      contextBus.emit("poll_updated", { groupId: poll.group_id, pollId });

      const updatedPoll = await prisma.polls.findUnique({
        where: { id: pollId },
        include: {
          options: {
            include: {
              votes: true,
            },
          },
        },
      });

      return {
        status: "OK",
        poll: updatedPoll ? formatPollState(updatedPoll, userId) : null,
        results: `/polls/${pollId}/results`,
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Vote submission failed" });
    }
  });
}
