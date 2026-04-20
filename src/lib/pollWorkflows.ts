import { prisma } from "./prisma.js";
import { contextBus } from "./contextBroadcast.js";
import { formatPollState } from "./polls.js";

export interface PollOptionInput {
  optionText: string;
  optionValue?: string | null;
}

export interface CreateEventPollInput {
  eventId: number;
  userId: number;
  question: string;
  options: PollOptionInput[];
  allowsMultiple?: boolean;
  allowsSuggestions?: boolean;
  expiresAt?: Date | null;
  setupField?: "name" | "location" | "eventTime" | "description" | null;
  isAutoPoll?: boolean;
}

function normalizeOptionValue(input: string | null | undefined) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value.length > 0 ? value : null;
}

export async function createPollForEvent(input: CreateEventPollInput) {
  const created = await prisma.polls.create({
    data: {
      event_id: input.eventId,
      user_id: input.userId,
      question: input.question.trim(),
      created_at: new Date(),
      expires_at: input.expiresAt ?? null,
      is_active: true,
      allows_multiple: input.allowsMultiple ?? false,
      allows_suggestions: input.allowsSuggestions ?? false,
      setup_field: input.setupField ?? null,
      options: {
        create: input.options.map((option) => ({
          option_text: option.optionText.trim(),
          option_value: normalizeOptionValue(option.optionValue ?? option.optionText),
        })),
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
      senderId: input.userId,
      content: `[AUTO_POLL:${created.id}] ${created.question}`,
    },
    include: { sender: { select: { id: true, name: true } } },
  });

  const pollState = formatPollState(created, input.userId);

  contextBus.emit("message_created", {
    eventId: input.eventId,
    message: {
      ...pollMessage,
      poll: pollState,
      isAutoPoll: input.isAutoPoll ?? true,
    },
  });

  contextBus.emit("poll_updated", { eventId: input.eventId, pollId: created.id });

  return {
    pollId: created.id,
    pollState,
  };
}

export async function syncEventFieldFromPollWinner(pollId: number) {
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

  if (!poll?.setup_field || !poll.event_id) return null;

  const rankedOptions = poll.options
    .map((option) => ({
      option,
      voteCount: option.votes.length,
    }))
    .sort((left, right) => {
      if (right.voteCount !== left.voteCount) return right.voteCount - left.voteCount;
      return left.option.id - right.option.id;
    });

  const winner = rankedOptions[0];
  if (!winner || winner.voteCount <= 0) return null;

  const optionValue = normalizeOptionValue(winner.option.option_value ?? winner.option.option_text);
  if (!optionValue) return null;

  switch (poll.setup_field) {
    case "name": {
      return prisma.event.update({
        where: { id: poll.event_id },
        data: { name: optionValue },
      });
    }
    case "location": {
      return prisma.event.update({
        where: { id: poll.event_id },
        data: { location: optionValue },
      });
    }
    case "description": {
      return prisma.event.update({
        where: { id: poll.event_id },
        data: { description: optionValue },
      });
    }
    case "eventTime": {
      const parsed = new Date(optionValue);
      if (Number.isNaN(parsed.getTime())) return null;
      return prisma.event.update({
        where: { id: poll.event_id },
        data: { eventTime: parsed },
      });
    }
    default:
      return null;
  }
}
