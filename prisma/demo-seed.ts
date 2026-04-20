import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { analyzeEventSetup, ATTRIBUTE_DEFS } from "../src/lib/context.js";
import { createPollForEvent } from "../src/lib/pollWorkflows.js";

const prisma = new PrismaClient();

async function main() {
  // 1. Create Colin
  const passwordHash = await bcrypt.hash("1234", 12);
  const colin = await prisma.user.upsert({
    where: { phone: "6199802813" },
    update: { name: "Colin", passwordHash },
    create: { name: "Colin", phone: "6199802813", passwordHash },
  });
  console.log(`Colin: id=${colin.id}`);

  await prisma.userAttribute.createMany({
    data: ATTRIBUTE_DEFS.map((a) => ({ userId: colin.id, key: a.key, score: a.defaultScore })),
    skipDuplicates: true,
  });

  // 2. Check if Demo group already exists for Colin
  const existing = await prisma.group.findFirst({ where: { name: "Demo", creatorId: colin.id } });
  if (existing) {
    console.log(`Demo group already exists (id=${existing.id}) — skipping.`);
    return;
  }

  // 3. Create the Demo group
  const group = await prisma.group.create({ data: { name: "Demo", creatorId: colin.id } });
  await prisma.groupMember.create({ data: { userId: colin.id, groupId: group.id, role: "admin" } });
  console.log(`Created Demo group: id=${group.id}`);

  // 4. Analyze the initial message via GPT
  const initialMessage = "Let's get dinner after this presentation";
  let setupAnalysis;
  try {
    setupAnalysis = await analyzeEventSetup({ groupName: group.name, initialMessage });
  } catch (e) {
    console.error("GPT analysis failed, continuing without polls:", e);
  }

  // 5. Create event with any extracted fields
  const event = await prisma.event.create({
    data: {
      groupId: group.id,
      creatorId: colin.id,
      name: "Dinner",
      ...(setupAnalysis?.extracted.location ? { location: setupAnalysis.extracted.location } : {}),
      ...(setupAnalysis?.extracted.eventTime ? { eventTime: new Date(setupAnalysis.extracted.eventTime) } : {}),
      ...(setupAnalysis?.extracted.description ? { description: setupAnalysis.extracted.description } : {}),
    },
  });
  console.log(`Created event: id=${event.id}`);

  // 6. Post the initial message
  const message = await prisma.message.create({
    data: { eventId: event.id, senderId: colin.id, content: initialMessage },
  });

  // 7. Mark Colin as "coming" (Event Suggester)
  const comingEmoji = await prisma.emojiType.findUnique({ where: { name: "coming" } });
  if (comingEmoji) {
    await prisma.messageContextEvidence.create({
      data: { messageId: message.id, emojiTypeId: comingEmoji.id, confidence: 0.95, displayQuote: "Event Suggester" },
    });
  }

  // 8. Create the auto-polls
  if (setupAnalysis) {
    for (const fieldPoll of setupAnalysis.fieldPolls) {
      await createPollForEvent({
        eventId: event.id,
        userId: colin.id,
        question: fieldPoll.question,
        options: fieldPoll.options,
        setupField: fieldPoll.field,
        allowsSuggestions: fieldPoll.field === "description" || fieldPoll.options.length === 0,
        isAutoPoll: true,
      });
    }
    for (const qPoll of setupAnalysis.questionPolls) {
      await createPollForEvent({
        eventId: event.id,
        userId: colin.id,
        question: qPoll.question,
        options: qPoll.options.map((o) => ({ optionText: o })),
        allowsMultiple: qPoll.allowsMultiple,
        allowsSuggestions: true,
        isAutoPoll: true,
      });
    }
    console.log(`Created ${setupAnalysis.fieldPolls.length} field polls + ${setupAnalysis.questionPolls.length} question polls`);
  }

  console.log("Demo seed complete!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
