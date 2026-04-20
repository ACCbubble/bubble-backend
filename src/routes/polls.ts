import { FastifyInstance } from "fastify";
import OpenAI from "openai";
import { prisma } from "../lib/prisma.js";
import { contextBus } from "../lib/contextBroadcast.js";
import { formatPollState, normalizeVoteSelection } from "../lib/polls.js";
import { createPollForEvent, syncEventFieldFromPollWinner } from "../lib/pollWorkflows.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function parseTimeToIso(text: string, timezone?: string): Promise<string | null> {
  try {
    // Try native parse first (handles full ISO strings with offset)
    const native = new Date(text);
    if (!isNaN(native.getTime()) && text.includes("T")) return native.toISOString();
    // Fall back to GPT for natural language like "11pm", "tomorrow 7pm", etc.
    const tz = timezone ?? "America/Chicago";
    const localNow = new Date().toLocaleString("en-US", { timeZone: tz });
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Convert the given time expression to ISO-8601 (with UTC offset). The user's timezone is ${tz}. Their current local time is ${localNow}. Return ONLY the ISO string, nothing else. If unparseable, return null.`,
        },
        { role: "user", content: text },
      ],
      max_tokens: 30,
    });
    const raw = res.choices[0].message.content?.trim() ?? "";
    if (raw === "null" || !raw) return null;
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch {
    return null;
  }
}

interface CreatePollPayload {
  userId: number;
  question: string;
  options: string[];
  expiresAt?: string;
  allowsMultiple?: boolean;
  setupField?: "name" | "location" | "eventTime" | "description" | null;
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

async function loadPollState(pollId: number, viewerUserId?: number) {
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

  if (!poll) return null;
  return formatPollState(poll, viewerUserId);
}

export async function pollRoutes(app: FastifyInstance) {
  app.post("/events/:eventId/polls", async (request, reply) => {
    const eventId = Number((request.params as { eventId: string }).eventId);
    const payload = request.body as CreatePollPayload;

    if (!Number.isInteger(eventId) || eventId <= 0) {
      return reply.status(400).send({ error: "Invalid eventId" });
    }

    try {
      const normalized = normalizePollPayload(payload);
      if ("error" in normalized) {
        return reply.status(400).send({ error: normalized.error });
      }

      const result = await createPollForEvent({
        eventId,
        userId: normalized.value.userId,
        question: normalized.value.question,
        options: normalized.value.options.map((optionText) => ({ optionText })),
        allowsMultiple: normalized.value.allowsMultiple,
        expiresAt: normalized.value.parsedExpiresAt,
        setupField: payload.setupField ?? null,
        isAutoPoll: false,
      });

      return reply.status(201).send({
        status: "OK",
        pollId: result.pollId,
        results: `/polls/${result.pollId}/results`,
        poll: result.pollState,
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
      const normalized = normalizePollPayload(payload);
      if ("error" in normalized) {
        return reply.status(400).send({ error: normalized.error });
      }

      const result = await createPollForEvent({
        eventId,
        userId: normalized.value.userId,
        question: normalized.value.question,
        options: normalized.value.options.map((optionText) => ({ optionText })),
        allowsMultiple: normalized.value.allowsMultiple,
        expiresAt: normalized.value.parsedExpiresAt,
        setupField: payload.setupField ?? null,
        isAutoPoll: false,
      });

      return reply.status(201).send({
        status: "OK",
        pollId: result.pollId,
        results: `/polls/${result.pollId}/results`,
        poll: result.pollState,
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
    const { userId } = request.query as { userId?: string };
    const viewerUserId = userId ? Number(userId) : undefined;

    if (!Number.isInteger(eventId) || eventId <= 0) {
      return reply.status(400).send({ error: "Invalid eventId" });
    }

    try {
      const polls = await prisma.polls.findMany({
        where: { event_id: eventId },
        orderBy: { id: "desc" },
        include: {
          options: {
            include: {
              votes: true,
            },
          },
        },
      });

      return polls.map((poll) => formatPollState(poll, viewerUserId));
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Failed to fetch polls" });
    }
  });

  app.get("/groups/:groupId/polls", async (request, reply) => {
    const groupId = Number((request.params as { groupId: string }).groupId);
    const { userId } = request.query as { userId?: string };
    const viewerUserId = userId ? Number(userId) : undefined;

    if (!Number.isInteger(groupId) || groupId <= 0) {
      return reply.status(400).send({ error: "Invalid groupId" });
    }

    try {
      const events = await prisma.event.findMany({ where: { groupId }, select: { id: true } });
      const eventIds = events.map((event) => event.id);
      const polls = await prisma.polls.findMany({
        where: { event_id: { in: eventIds } },
        orderBy: { id: "desc" },
        include: {
          options: {
            include: {
              votes: true,
            },
          },
        },
      });

      return polls.map((poll) => formatPollState(poll, viewerUserId));
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
      const poll = await loadPollState(pollId, viewerUserId);

      if (!poll) {
        return reply.status(404).send({ error: "Poll not found" });
      }

      return poll;
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

      let selectedOptionIds: number[];
      try {
        selectedOptionIds = normalizeVoteSelection({
          allowsMultiple: Boolean(poll.allows_multiple),
          optionId,
          optionIds,
        });
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }

      const invalidOptionId = selectedOptionIds.find(
        (selectedId) => !poll.options.some((option) => option.id === selectedId),
      );
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

      await syncEventFieldFromPollWinner(pollId);
      contextBus.emit("poll_updated", { eventId: poll.event_id, pollId });

      return {
        status: "OK",
        poll: await loadPollState(pollId, userId),
        results: `/polls/${pollId}/results`,
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Vote submission failed" });
    }
  });

  app.post("/polls/:pollId/suggestions", async (request, reply) => {
    const pollId = Number((request.params as { pollId: string }).pollId);
    const { userId, optionText, timezone } = request.body as { userId: number; optionText: string; timezone?: string };

    if (!Number.isInteger(pollId) || pollId <= 0) {
      return reply.status(400).send({ error: "Invalid pollId" });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
      return reply.status(400).send({ error: "Invalid userId" });
    }
    const trimmed = typeof optionText === "string" ? optionText.trim() : "";
    if (!trimmed) {
      return reply.status(400).send({ error: "optionText is required" });
    }

    try {
      const poll = await prisma.polls.findUnique({ where: { id: pollId } });
      if (!poll) return reply.status(404).send({ error: "Poll not found" });
      if (!poll.allows_suggestions) return reply.status(400).send({ error: "Poll does not allow suggestions" });
      if (poll.is_active === false) return reply.status(400).send({ error: "Poll is no longer active" });
      if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
        return reply.status(400).send({ error: "Poll has expired" });
      }

      // For eventTime polls, parse the text to ISO-8601 so syncEventFieldFromPollWinner can use it
      let optionValue = trimmed;
      if (poll.setup_field === "eventTime") {
        const iso = await parseTimeToIso(trimmed, timezone);
        if (iso) optionValue = iso;
      }

      // Create the option then immediately vote for it
      const option = await prisma.options.create({
        data: { poll_id: pollId, option_text: trimmed, option_value: optionValue },
      });

      // Remove any existing votes by this user on this poll then cast for the new option
      await prisma.$transaction([
        prisma.votes.deleteMany({ where: { poll_id: pollId, user_id: userId } }),
        prisma.votes.create({
          data: { poll_id: pollId, user_id: userId, option_id: option.id, created_at: new Date() },
        }),
      ]);

      await syncEventFieldFromPollWinner(pollId);
      contextBus.emit("poll_updated", { eventId: poll.event_id, pollId });

      return {
        status: "OK",
        poll: await loadPollState(pollId, userId),
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(400).send({ error: "Suggestion failed" });
    }
  });
}
