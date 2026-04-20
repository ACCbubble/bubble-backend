import OpenAI from 'openai'
import { prisma } from './prisma.js'
import { contextBus } from './contextBroadcast.js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export const ATTRIBUTE_DEFS = [
  { key: 'has_car', description: 'User owns or has regular access to a car', defaultScore: 0.65 },
  { key: 'has_dietary_restriction', description: 'User has food allergies or dietary restrictions', defaultScore: 0.1 },
  { key: 'is_student', description: 'User is currently a student', defaultScore: 0.7 },
]

export const EMOJI_TYPE_SEEDS = [
  { name: 'coming', emoji: '✅', description: 'User is coming to the event', defaultScore: 0.0 },
  { name: 'not_coming', emoji: '❌', description: 'User is not coming to the event', defaultScore: 0.0 },
  { name: 'maybe', emoji: '❓', description: 'User might come to the event', defaultScore: 0.0 },
  { name: 'needs_ride', emoji: '🚗', description: 'User needs a ride to the event', defaultScore: 0.0 },
  { name: 'bringing_food', emoji: '🍕', description: 'User is bringing food to the event', defaultScore: 0.0 },
]

const MIN_CONFIDENCE = 0.3
const MAX_QUOTE_CHARS = 100

interface AttrResult {
  key: string
  signal: 'positive' | 'negative'
  confidence: number
  quote: string
}

interface EmojiResult {
  emojiId: number
  confidence: number
  quote: string
}

export interface PollDraft {
  question: string
  options: string[]
  allowsMultiple: boolean
}

interface ClassificationResult {
  attributes: AttrResult[]
  emojis: EmojiResult[]
  shouldBePoll: boolean
  pollDraft?: {
    question?: string
    options?: string[]
    allowsMultiple?: boolean
  }
}

export async function processMessageContext(
  messageId: number,
  senderId: number,
  groupId: number,
  content: string,
): Promise<PollDraft | null> {
  try {
    const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { name: true } })
    if (!sender) return null

    const emojiTypes = await prisma.emojiType.findMany()
    const result = await classifyMessage(content, sender.name, emojiTypes)

    for (const attr of result.attributes ?? []) {
      if (attr.confidence < MIN_CONFIDENCE || !ATTRIBUTE_DEFS.find(a => a.key === attr.key)) continue
      await updateAttribute(senderId, attr.key, attr.signal, attr.confidence)
      const quote = trimQuote(attr.quote)
      if (quote) {
        await prisma.messageContextEvidence.create({
          data: {
            messageId,
            attributeKey: attr.key,
            direction: attr.signal,
            confidence: attr.confidence,
            displayQuote: quote,
          },
        })
      }
    }

    for (const em of result.emojis ?? []) {
      if (em.confidence < MIN_CONFIDENCE) continue
      const emojiType = emojiTypes.find(e => e.id === em.emojiId)
      if (!emojiType) continue
      const quote = trimQuote(em.quote)
      if (quote) {
        await prisma.messageContextEvidence.create({
          data: {
            messageId,
            emojiTypeId: em.emojiId,
            confidence: em.confidence,
            displayQuote: quote,
          },
        })
      }
    }

    contextBus.emit('context_updated', { groupId, userId: senderId })
    return sanitizePollDraft(result)
  } catch (err) {
    console.error('[context] processing failed:', err)
    return null
  }
}

function sanitizePollDraft(result: ClassificationResult): PollDraft | null {
  if (!result.shouldBePoll) return null

  const rawQuestion = result.pollDraft?.question?.trim()
  const rawOptions = result.pollDraft?.options
    ?.map(option => option.trim())
    .filter((option): option is string => option.length > 0)

  if (!rawQuestion || !rawOptions || rawOptions.length < 2) return null

  const uniqueOptions = [...new Set(rawOptions)].slice(0, 6)
  if (uniqueOptions.length < 2) return null

  return {
    question: rawQuestion.slice(0, 200),
    options: uniqueOptions,
    allowsMultiple: Boolean(result.pollDraft?.allowsMultiple),
  }
}

async function classifyMessage(
  content: string,
  senderName: string,
  emojiTypes: Array<{ id: number; name: string; emoji: string; description: string }>,
): Promise<ClassificationResult> {
  const attrList = ATTRIBUTE_DEFS.map(a => `- ${a.key}: ${a.description}`).join('\n')
  const emojiList = emojiTypes.map(e => `- id ${e.id}, "${e.name}" ${e.emoji}: ${e.description}`).join('\n')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You analyze chat messages and extract structured context about the sender. Return only valid JSON.`,
      },
      {
        role: 'user',
        content: `Sender: ${senderName}
Message: "${content}"

ATTRIBUTES (permanent user profile signals):
${attrList}

EVENT CONTEXT TYPES (emoji types):
${emojiList}

Return JSON in exactly this shape:
{
  "attributes": [{ "key": string, "signal": "positive"|"negative", "confidence": number, "quote": string }],
  "emojis": [{ "emojiId": number, "confidence": number, "quote": string }],
  "shouldBePoll": boolean,
  "pollDraft": {
    "question": string,
    "options": string[],
    "allowsMultiple": boolean
  }
}

Poll rules:
- If shouldBePoll is false, set pollDraft to an empty object.
- If true, include at least 2 concise options.
- Keep question <= 200 chars, option text <= 80 chars.

Quote rules:
- Extract only the relevant fragment from the message text
- Max ${MAX_QUOTE_CHARS} characters
- Use "..." to skip over unimportant parts while keeping it coherent
- Only include items with confidence >= ${MIN_CONFIDENCE}
- Arrays may be empty`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500,
  })

  const raw = response.choices[0].message.content ?? '{}'
  return JSON.parse(raw) as ClassificationResult
}

function trimQuote(quote: string | undefined): string {
  if (!quote) return ''
  return quote.slice(0, MAX_QUOTE_CHARS)
}

async function updateAttribute(
  userId: number,
  key: string,
  signal: 'positive' | 'negative',
  confidence: number,
) {
  const existing = await prisma.userAttribute.findUnique({ where: { userId_key: { userId, key } } })
  const def = ATTRIBUTE_DEFS.find(a => a.key === key)
  const old = existing?.score ?? def?.defaultScore ?? 0.5
  const delta = confidence * old * (1 - old)
  const newScore = Math.max(0.01, Math.min(0.99, signal === 'positive' ? old + delta : old - delta))

  await prisma.userAttribute.upsert({
    where: { userId_key: { userId, key } },
    update: { score: newScore },
    create: { userId, key, score: newScore },
  })
}
