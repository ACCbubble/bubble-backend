import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { analyzeEventSetup, processMessageContext } from "../lib/context.js";
import { createPollForEvent } from "../lib/pollWorkflows.js";
import { contextBus } from "../lib/contextBroadcast.js";

export async function eventRoutes(app: FastifyInstance) {
  // GET /groups/:id/events — list events in a group (members only)
  app.get(
    "/groups/:id/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const userId = request.user.userId;

      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });
      if (!membership) return reply.status(403).send({ error: "Not a member" });

      return prisma.event.findMany({
        where: { groupId },
        orderBy: { createdAt: "desc" },
      });
    }
  );

  // POST /groups/:id/events — create event in a group
  app.post(
    "/groups/:id/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const groupId = Number((request.params as { id: string }).id);
      const creatorId = request.user.userId;
      const { name, location, eventTime, description, initialMessage } = request.body as {
        name: string;
        location?: string;
        eventTime?: string;
        description?: string;
        initialMessage?: string;
      };

      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: creatorId, groupId } },
      });
      if (!membership) return reply.status(403).send({ error: "Not a member" });

      try {
        const msgTrimmed = initialMessage?.trim() ?? "";

        // Analyze the initial message via GPT to extract event fields and generate polls
        let setupAnalysis = null;
        if (msgTrimmed) {
          try {
            const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });
            setupAnalysis = await analyzeEventSetup({
              groupName: group?.name ?? name,
              initialMessage: msgTrimmed,
            });
          } catch {
            // GPT failure is non-fatal — event still gets created
          }
        }

        const finalName = name || setupAnalysis?.extracted.name || "New Event";
        const resolvedLocation = location ?? setupAnalysis?.extracted.location ?? undefined;
        const resolvedEventTime = eventTime ?? setupAnalysis?.extracted.eventTime ?? undefined;
        const resolvedDescription = description ?? setupAnalysis?.extracted.description ?? undefined;

        const event = await prisma.event.create({
          data: {
            groupId,
            creatorId,
            name: finalName,
            ...(resolvedLocation !== undefined && { location: resolvedLocation }),
            ...(resolvedEventTime !== undefined && { eventTime: resolvedEventTime ? new Date(resolvedEventTime) : null }),
            ...(resolvedDescription !== undefined && { description: resolvedDescription }),
          },
        });

        // Create the initial message and mark the creator as "coming"
        if (msgTrimmed) {
          const message = await prisma.message.create({
            data: { eventId: event.id, senderId: creatorId, content: msgTrimmed },
            include: { sender: { select: { id: true, name: true } } },
          });
          contextBus.emit("message_created", { eventId: event.id, message });
          processMessageContext(message.id, creatorId, event.id, msgTrimmed).catch(() => {});

          // Give the creator a "coming" signal automatically
          const comingEmoji = await prisma.emojiType.findUnique({ where: { name: "coming" } });
          if (comingEmoji) {
            await prisma.messageContextEvidence.create({
              data: {
                messageId: message.id,
                emojiTypeId: comingEmoji.id,
                confidence: 0.95,
                displayQuote: "Event Suggester",
              },
            });
          }
        }

        // Create field polls for missing event details
        if (setupAnalysis) {
          for (const fieldPoll of setupAnalysis.fieldPolls) {
            await createPollForEvent({
              eventId: event.id,
              userId: creatorId,
              question: fieldPoll.question,
              options: fieldPoll.options,
              setupField: fieldPoll.field,
              allowsSuggestions: fieldPoll.field === "description" || fieldPoll.options.length === 0,
              isAutoPoll: true,
            });
          }
          // Create polls from questions in the initial message (open-ended — allow suggestions)
          for (const qPoll of setupAnalysis.questionPolls) {
            await createPollForEvent({
              eventId: event.id,
              userId: creatorId,
              question: qPoll.question,
              options: qPoll.options.map((o) => ({ optionText: o })),
              allowsMultiple: qPoll.allowsMultiple,
              allowsSuggestions: true,
              isAutoPoll: true,
            });
          }
        }

        return event;
      } catch {
        reply.status(400).send({ error: "Event creation failed" });
      }
    }
  );

  // GET /events/:id — auth optional (unauthenticated requests skip membership check, used by /demo)
  app.get(
    "/events/:id",
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);

      const event = await prisma.event.findUnique({ where: { id } });
      if (!event) return reply.status(404).send({ error: "Event not found" });

      // If authenticated, enforce membership
      try {
        await request.jwtVerify();
        const userId = (request.user as { userId: number }).userId;
        const membership = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId, groupId: event.groupId } },
        });
        if (!membership) return reply.status(403).send({ error: "Not a member" });
      } catch {
        // No valid auth — allow read-only access (demo mode)
      }

      return event;
    }
  );

  // PATCH /events/:id — update event details
  app.patch(
    "/events/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      return reply.status(403).send({ error: "Event details are managed by poll results" });
    }
  );
}
