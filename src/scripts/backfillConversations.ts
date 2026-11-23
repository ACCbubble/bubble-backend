import { backfillConversations } from "../lib/backfillConversations.js";
import { prisma } from "../lib/prisma.js";

try {
  const result = await backfillConversations();
  console.log("Conversation backfill complete:", result);
} catch (error) {
  console.error("Conversation backfill failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
