import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const colin = await prisma.user.findUnique({ where: { phone: "6199802813" } });
  if (!colin) { console.log("Colin not found, nothing to reset."); return; }

  const group = await prisma.group.findFirst({ where: { name: "Demo", creatorId: colin.id } });
  if (!group) { console.log("Demo group not found, nothing to reset."); return; }

  const events = await prisma.event.findMany({ where: { groupId: group.id } });
  for (const ev of events) {
    const msgs = await prisma.message.findMany({ where: { eventId: ev.id } });
    for (const m of msgs) {
      await prisma.messageContextEvidence.deleteMany({ where: { messageId: m.id } });
    }
    const polls = await prisma.polls.findMany({ where: { event_id: ev.id } });
    for (const p of polls) {
      await prisma.votes.deleteMany({ where: { poll_id: p.id } });
      await prisma.options.deleteMany({ where: { poll_id: p.id } });
    }
    await prisma.polls.deleteMany({ where: { event_id: ev.id } });
    await prisma.message.deleteMany({ where: { eventId: ev.id } });
  }
  await prisma.event.deleteMany({ where: { groupId: group.id } });
  await prisma.groupMember.deleteMany({ where: { groupId: group.id } });
  await prisma.group.delete({ where: { id: group.id } });
  console.log("Demo group and all related data deleted.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
