import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'

const HALF_LIFE_HOURS = 24
const LAMBDA = Math.LN2 / HALF_LIFE_HOURS
const MAX_EMOJIS = 4
const MAX_QUOTES = 4

function recencyWeight(createdAt: Date): number {
  const hoursAgo = (Date.now() - createdAt.getTime()) / 3_600_000
  return Math.exp(-LAMBDA * hoursAgo)
}

function computeEmojiScore(evidences: Array<{ confidence: number; createdAt: Date }>): number {
  if (evidences.length === 0) return 0
  let wSum = 0, wTotal = 0
  for (const ev of evidences) {
    const w = recencyWeight(ev.createdAt)
    wSum += ev.confidence * w
    wTotal += w
  }
  return wTotal > 0 ? Math.min(wSum / wTotal, 0.99) : 0
}

export async function roundtableRoutes(app: FastifyInstance) {
  app.get('/roundtable', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { eventId, groupId } = request.query as { eventId?: string; groupId?: string }
    if (!eventId && !groupId) {
      return reply.status(400).send({ error: 'eventId or groupId required' })
    }

    let eid: number | null = null
    let gid: number

    if (eventId) {
      eid = Number(eventId)
      if (!Number.isInteger(eid) || eid <= 0) {
        return reply.status(400).send({ error: 'Invalid eventId' })
      }

      const event = await prisma.event.findUnique({ where: { id: eid } })
      if (!event) return reply.status(404).send({ error: 'Event not found' })
      gid = event.groupId
    } else {
      gid = Number(groupId)
      if (!Number.isInteger(gid) || gid <= 0) {
        return reply.status(400).send({ error: 'Invalid groupId' })
      }
    }

    const members = await prisma.groupMember.findMany({
      where: { groupId: gid },
      include: { user: { select: { id: true, name: true } } },
    })

    const memberData = await Promise.all(
      members.map(async m => {
        const evidence = await prisma.messageContextEvidence.findMany({
          where: {
            emojiTypeId: { not: null },
            message: eid
              ? { eventId: eid, senderId: m.userId }
              : { event: { groupId: gid }, senderId: m.userId },
          },
          include: { message: { select: { createdAt: true } } },
        })

        const byEmoji = new Map<number, typeof evidence>()
        for (const ev of evidence) {
          if (!ev.emojiTypeId) continue
          if (!byEmoji.has(ev.emojiTypeId)) byEmoji.set(ev.emojiTypeId, [])
          byEmoji.get(ev.emojiTypeId)!.push(ev)
        }

        const scored = [...byEmoji.entries()]
          .map(([emojiId, evs]) => {
            const score = computeEmojiScore(
              evs.map(e => ({ confidence: e.confidence, createdAt: e.message.createdAt })),
            )
            const topQuotes = evs
              .slice()
              .sort((a, b) => {
                const wa = a.confidence * recencyWeight(a.message.createdAt)
                const wb = b.confidence * recencyWeight(b.message.createdAt)
                return wb - wa
              })
              .slice(0, MAX_QUOTES)
              .map(e => e.displayQuote)

            return { emojiId, score, topQuotes }
          })
          .filter(e => e.score > 0.05)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_EMOJIS)

        return { userId: m.user.id, name: m.user.name, emojis: scored }
      }),
    )

    return { members: memberData }
  })

  app.get('/emoji-types', async () => {
    return prisma.emojiType.findMany({ select: { id: true, name: true, emoji: true } })
  })

  app.get('/attributes', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.query as { userId?: string }
    if (!userId) return reply.status(400).send({ error: 'userId required' })

    const attrs = await prisma.userAttribute.findMany({
      where: { userId: Number(userId) },
      select: { key: true, score: true },
    })

    return { attributes: attrs }
  })
}
