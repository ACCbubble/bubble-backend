import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma.js";
import { createMessageWithConversation, ConversationError } from "./conversations.js";
import { backfillConversations } from "./backfillConversations.js";
import { createPollForEvent } from "./pollWorkflows.js";

// Database tests must never run against the regular development database.
const databaseUrl = process.env.DATABASE_URL;
const safeDatabase = (() => {
  try {
    return databaseUrl ? new URL(databaseUrl).pathname.slice(1) === "bubble_test" : false;
  } catch {
    return false;
  }
})();
const enabled = process.env.BUBBLE_TEST_DATABASE === "1" && safeDatabase;

test("PostgreSQL conversations, polls, concurrency, and historical backfill", { skip: !enabled }, async () => {
  const unique = `integration-${Date.now()}-${process.pid}`;
  const user = await prisma.user.create({
    data: { name: unique, phone: unique, passwordHash: "integration-test-only" },
  });
  let groupId: number | undefined;

  try {
    const group = await prisma.group.create({
      data: { name: unique, creatorId: user.id },
    });
    groupId = group.id;
    const event = await prisma.event.create({
      data: { name: unique, creatorId: user.id, groupId: group.id },
    });

    const first = await createMessageWithConversation({
      eventId: event.id, senderId: user.id, content: "first",
    });
    const second = await createMessageWithConversation({
      eventId: event.id, senderId: user.id, content: "second",
    });
    assert.equal(second.conversationId, first.conversationId);

    const reply = await createMessageWithConversation({
      eventId: event.id, senderId: user.id, content: "reply", replyToId: first.id,
    });
    assert.equal(reply.conversationId, first.conversationId);
    assert.equal(reply.replyToId, first.id);

    await assert.rejects(
      createMessageWithConversation({
        eventId: event.id, senderId: user.id, content: "invalid", replyToId: 999999999,
      }),
      ConversationError,
    );

    // Simulate a gap without waiting ten minutes in real time.
    await prisma.message.updateMany({
      where: { eventId: event.id },
      data: { createdAt: new Date(Date.now() - 15 * 60_000) },
    });
    const newer = await createMessageWithConversation({
      eventId: event.id, senderId: user.id, content: "new conversation",
    });
    assert.notEqual(newer.conversationId, first.conversationId);

    const oldReply = await createMessageWithConversation({
      eventId: event.id, senderId: user.id, content: "old reply", replyToId: first.id,
    });
    assert.equal(oldReply.conversationId, first.conversationId);
    const afterReply = await createMessageWithConversation({
      eventId: event.id, senderId: user.id, content: "still new conversation",
    });
    assert.equal(afterReply.conversationId, newer.conversationId);

    // Concurrent requests must share the active conversation.
    const simultaneous = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createMessageWithConversation({
          eventId: event.id, senderId: user.id, content: `concurrent ${index}`,
        }),
      ),
    );
    for (const message of simultaneous) {
      assert.equal(message.conversationId, newer.conversationId);
    }

    // Test the real poll workflow, not a simulated poll-like message.
    const poll = await createPollForEvent({
      eventId: event.id,
      userId: user.id,
      question: "Test poll?",
      options: [{ optionText: "Yes" }, { optionText: "No" }],
      isAutoPoll: false,
    });
    const pollMessage = await prisma.message.findFirstOrThrow({
      where: { eventId: event.id, content: { startsWith: `[AUTO_POLL:${poll.pollId}]` } },
    });
    assert.equal(pollMessage.conversationId, newer.conversationId);

    // Historical messages without a conversation ID should be assigned one.
    const historical = await prisma.message.create({
      data: {
        eventId: event.id,
        senderId: user.id,
        content: "historical",
        createdAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
    const result = await backfillConversations();
    assert.ok(result.updated >= 1);
    const filled = await prisma.message.findUniqueOrThrow({ where: { id: historical.id } });
    assert.notEqual(filled.conversationId, null);
    const firstAfter = await prisma.message.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(firstAfter.conversationId, first.conversationId);
    const again = await backfillConversations();
    assert.equal(again.updated, 0);

  } finally {
    if (groupId !== undefined) {
      // Clean up any remaining poll rows before deleting the group.
      const eventIds = (await prisma.event.findMany({
        where: { groupId }, select: { id: true },
      })).map((event) => event.id);
      const pollIds = (await prisma.polls.findMany({
        where: { event_id: { in: eventIds } }, select: { id: true },
      })).map((poll) => poll.id);
      await prisma.votes.deleteMany({ where: { poll_id: { in: pollIds } } });
      await prisma.options.deleteMany({ where: { poll_id: { in: pollIds } } });
      await prisma.polls.deleteMany({ where: { id: { in: pollIds } } });
      await prisma.group.delete({ where: { id: groupId } });
    }
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
