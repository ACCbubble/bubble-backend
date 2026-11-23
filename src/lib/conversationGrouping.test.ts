import assert from "node:assert/strict";
import test from "node:test";
import { groupMessages } from "./conversationGrouping.js";

const message = (id: number, eventId: number, minute: number, replyToId?: number) => ({
  id, eventId, createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)), replyToId,
});

test("groups nearby messages and separates later messages", () => {
  assert.deepEqual(groupMessages([message(1, 1, 0), message(2, 1, 10), message(3, 1, 21)]).map(m => m.conversationId), [1, 1, 2]);
});
test("keeps different events separate", () => {
  assert.deepEqual(groupMessages([message(1, 1, 0), message(2, 2, 1)]).map(m => m.conversationId), [1, 2]);
});
test("reply joins old conversation without changing the active thread", () => {
  const result = groupMessages([message(1, 1, 0), message(2, 1, 30), message(3, 1, 31, 1), message(4, 1, 32)]);
  assert.deepEqual(result.map(m => m.conversationId), [1, 2, 1, 2]);
});
test("rejects cross-event replies and duplicate IDs", () => {
  assert.throws(() => groupMessages([message(1, 1, 0), message(2, 2, 1, 1)]), /Invalid reply/);
  assert.throws(() => groupMessages([message(1, 1, 0), message(1, 1, 1)]), /Duplicate/);
});
