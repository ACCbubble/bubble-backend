
export type ConversationMessage = {
  id: number;
  eventId: number;
  createdAt: Date;
  replyToId?: number | null;
};

export type GroupedMessage = ConversationMessage & {
  conversationId: number;
};

// Groups messages by time, while keeping replies in their original conversation.
export function groupMessages(
  messages: ConversationMessage[],
  gapMinutes = 10,
): GroupedMessage[] {
  if (!Number.isFinite(gapMinutes) || gapMinutes < 0) {
    throw new Error("gapMinutes must be a non-negative number");
  }

  // Sort a copy so the original message array is not changed.
  const sorted = [...messages].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
  );

  const byId = new Map<number, GroupedMessage>();
  const latestByEvent = new Map<number, GroupedMessage>();
  const grouped: GroupedMessage[] = [];
  let nextConversationId = 1;

  for (const message of sorted) {
    if (byId.has(message.id)) {
      throw new Error(`Duplicate message ID: ${message.id}`);
    }

    let conversationId: number | undefined;

    if (message.replyToId != null) {
      // Replies use the same conversation as their parent message.
      const parent = byId.get(message.replyToId);

      if (!parent || parent.eventId !== message.eventId) {
        throw new Error(`Invalid reply for message ${message.id}`);
      }

      conversationId = parent.conversationId;
    } else {
      // Normal messages join the latest conversation if the time gap is small.
      const latest = latestByEvent.get(message.eventId);

      if (
        latest &&
        message.createdAt.getTime() - latest.createdAt.getTime()
          <= gapMinutes * 60_000
      ) {
        conversationId = latest.conversationId;
      }
    }

    // Create a new conversation only when no existing one was found.
    conversationId ??= nextConversationId++;

    const result = { ...message, conversationId };
    grouped.push(result);
    byId.set(message.id, result);

    // Replies to older conversations should not replace the active conversation.
    if (message.replyToId == null) {
      latestByEvent.set(message.eventId, result);
    }
  }

  return grouped;
}
