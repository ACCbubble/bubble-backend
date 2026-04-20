import { FastifyReply } from "fastify";
import { prisma } from "./prisma.js";

export async function requireGroupMemberAccess(
  userId: number,
  groupId: number,
  reply: FastifyReply,
): Promise<boolean> {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { id: true },
  });

  if (!membership) {
    reply.status(403).send({ error: "Forbidden" });
    return false;
  }

  return true;
}

export async function findEventWithAccess(eventId: number, userId: number) {
  return prisma.event.findFirst({
    where: {
      id: eventId,
      group: {
        groupMembers: {
          some: { userId },
        },
      },
    },
  });
}

export async function getEventGroupId(eventId: number): Promise<number | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { groupId: true },
  });

  return event?.groupId ?? null;
}
