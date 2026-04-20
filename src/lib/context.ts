import OpenAI from 'openai'
import { prisma } from './prisma.js'
import { contextBus } from './contextBroadcast.js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── ATTRIBUTE DEFINITIONS ───────────────────────────────────────────────────
// These represent persistent user profile signals inferred from messages.
// defaultScore = prior probability before any evidence.
export const ATTRIBUTE_DEFS = [
  // Transportation
  { key: 'has_car',           description: 'User owns or has regular access to a car',         defaultScore: 0.65 },
  { key: 'needs_ride',        description: 'User frequently needs rides to events',             defaultScore: 0.20 },
  { key: 'has_bike',          description: 'User commutes by bike',                             defaultScore: 0.20 },
  { key: 'uses_transit',      description: 'User relies on public transit',                     defaultScore: 0.35 },
  { key: 'can_carpool',       description: 'User is open to carpooling with others',            defaultScore: 0.50 },

  // Food & Diet
  { key: 'has_dietary_restriction', description: 'User has food allergies or dietary restrictions', defaultScore: 0.10 },
  { key: 'is_vegetarian',     description: 'User is vegetarian or vegan',                       defaultScore: 0.10 },
  { key: 'is_vegan',          description: 'User is strictly vegan',                            defaultScore: 0.05 },
  { key: 'is_kosher',         description: 'User keeps kosher',                                 defaultScore: 0.05 },
  { key: 'is_halal',          description: 'User eats halal food only',                         defaultScore: 0.08 },
  { key: 'has_nut_allergy',   description: 'User has a nut allergy',                            defaultScore: 0.05 },
  { key: 'has_gluten_intolerance', description: 'User is gluten intolerant or has celiac', defaultScore: 0.05 },
  { key: 'likes_cooking',     description: 'User enjoys cooking and often brings homemade food', defaultScore: 0.40 },
  { key: 'will_bring_food',   description: 'User often brings food or snacks to events',        defaultScore: 0.30 },

  // Demographics
  { key: 'is_student',        description: 'User is currently a student',                       defaultScore: 0.70 },
  { key: 'is_grad_student',   description: 'User is a graduate or PhD student',                 defaultScore: 0.20 },
  { key: 'is_faculty',        description: 'User is a professor or faculty member',             defaultScore: 0.05 },
  { key: 'is_local',          description: 'User lives close to the event location',            defaultScore: 0.50 },
  { key: 'is_out_of_town',    description: 'User is visiting or lives far from the event',      defaultScore: 0.10 },
  { key: 'is_21_plus',        description: 'User is 21 or older',                               defaultScore: 0.60 },
  { key: 'has_kids',          description: 'User has children',                                 defaultScore: 0.10 },
  { key: 'has_pet',           description: 'User has a pet',                                    defaultScore: 0.35 },

  // Availability & Scheduling
  { key: 'usually_late',      description: 'User tends to arrive late to events',               defaultScore: 0.20 },
  { key: 'usually_early',     description: 'User tends to arrive early to events',              defaultScore: 0.15 },
  { key: 'works_weekends',    description: 'User works on weekends',                            defaultScore: 0.25 },
  { key: 'night_owl',         description: 'User prefers late-night events',                    defaultScore: 0.30 },
  { key: 'morning_person',    description: 'User prefers morning or daytime activities',        defaultScore: 0.30 },
  { key: 'has_strict_schedule', description: 'User has a rigid or packed schedule',            defaultScore: 0.25 },
  { key: 'is_flexible',       description: 'User is flexible with timing and plans',            defaultScore: 0.50 },

  // Social & Personality
  { key: 'is_organizer',      description: 'User often organizes or helps plan events',         defaultScore: 0.20 },
  { key: 'is_introvert',      description: 'User is introverted or prefers smaller gatherings', defaultScore: 0.35 },
  { key: 'is_extrovert',      description: 'User is energetic and social',                      defaultScore: 0.35 },
  { key: 'brings_friends',    description: 'User often brings additional guests',               defaultScore: 0.25 },
  { key: 'is_new_to_group',   description: 'User is new to the group or community',             defaultScore: 0.10 },
  { key: 'is_regular',        description: 'User is a regular attendee of group events',        defaultScore: 0.40 },
  { key: 'is_photographer',   description: 'User takes photos at events',                       defaultScore: 0.15 },
  { key: 'is_host',           description: 'User is willing to host at their place',            defaultScore: 0.15 },

  // Skills & Interests
  { key: 'is_musician',       description: 'User plays music or performs',                      defaultScore: 0.10 },
  { key: 'is_athlete',        description: 'User is sporty or does physical activities',        defaultScore: 0.30 },
  { key: 'likes_games',       description: 'User enjoys board games, card games, or video games', defaultScore: 0.35 },
  { key: 'likes_hiking',      description: 'User enjoys outdoor activities like hiking',        defaultScore: 0.25 },
  { key: 'likes_sports',      description: 'User watches or plays sports',                      defaultScore: 0.40 },
  { key: 'likes_movies',      description: 'User enjoys watching movies',                       defaultScore: 0.50 },
  { key: 'likes_music',       description: 'User has strong interest in music / concerts',      defaultScore: 0.45 },
  { key: 'is_techie',         description: 'User is tech-savvy or works in tech',               defaultScore: 0.35 },
  { key: 'is_creative',       description: 'User is artistic or creative',                      defaultScore: 0.25 },
  { key: 'is_reader',         description: 'User reads a lot and likes book-related topics',    defaultScore: 0.25 },

  // Health & Lifestyle
  { key: 'is_sober',          description: 'User does not drink alcohol',                       defaultScore: 0.15 },
  { key: 'drinks_alcohol',    description: 'User drinks at social events',                      defaultScore: 0.55 },
  { key: 'smokes',            description: 'User smokes',                                       defaultScore: 0.10 },
  { key: 'is_health_conscious', description: 'User is focused on health and fitness',           defaultScore: 0.30 },
  { key: 'is_night_swimmer',  description: 'User likes water activities including swimming',    defaultScore: 0.15 },

  // Accessibility & Needs
  { key: 'needs_accessibility', description: 'User has mobility or accessibility needs',       defaultScore: 0.05 },
  { key: 'has_hearing_impairment', description: 'User has hearing difficulties',               defaultScore: 0.03 },
  { key: 'is_claustrophobic', description: 'User prefers open spaces, avoids crowds',          defaultScore: 0.08 },
  { key: 'is_pet_allergic',   description: 'User is allergic to pets',                         defaultScore: 0.10 },

  // Event Preferences
  { key: 'prefers_small_events', description: 'User prefers intimate gatherings over large parties', defaultScore: 0.35 },
  { key: 'prefers_outdoors',  description: 'User prefers outdoor settings for events',          defaultScore: 0.40 },
  { key: 'prefers_indoors',   description: 'User prefers indoor settings for events',           defaultScore: 0.40 },
  { key: 'prefers_daytime',   description: 'User prefers daytime activities',                   defaultScore: 0.35 },
  { key: 'prefers_nighttime', description: 'User prefers evening or nighttime activities',      defaultScore: 0.35 },
  { key: 'budget_conscious',  description: 'User is price-sensitive or on a budget',            defaultScore: 0.40 },
  { key: 'is_generous',       description: 'User often offers to pay or bring extra items',     defaultScore: 0.20 },

  // Volunteering & Logistics
  { key: 'can_help_setup',    description: 'User is available to help set up events',           defaultScore: 0.25 },
  { key: 'can_help_cleanup',  description: 'User is available to help clean up after events',   defaultScore: 0.20 },
  { key: 'has_equipment',     description: 'User has useful equipment (speakers, tent, grill)', defaultScore: 0.15 },
  { key: 'has_large_vehicle', description: 'User has a van/truck that can transport gear',      defaultScore: 0.10 },
  { key: 'knows_venue',       description: 'User is familiar with the event venue',             defaultScore: 0.15 },

  // Communication Style
  { key: 'responds_quickly',  description: 'User typically responds quickly to messages',       defaultScore: 0.45 },
  { key: 'prefers_direct_communication', description: 'User prefers concise direct messages',  defaultScore: 0.40 },
  { key: 'is_humorous',       description: 'User frequently makes jokes in chat',               defaultScore: 0.30 },
  { key: 'is_serious',        description: 'User tends toward serious or factual communication',defaultScore: 0.25 },

  // Relationships within group
  { key: 'is_close_with_organizer', description: 'User has a close relationship with the event organizer', defaultScore: 0.20 },
  { key: 'brings_plus_one',   description: 'User often brings a partner or plus-one',           defaultScore: 0.20 },
  { key: 'knows_everyone',    description: 'User knows most group members personally',          defaultScore: 0.30 },

  // Professional & Academic
  { key: 'is_busy_professional', description: 'User has a demanding job or career',            defaultScore: 0.30 },
  { key: 'is_unemployed',     description: 'User is currently between jobs',                    defaultScore: 0.10 },
  { key: 'is_remote_worker',  description: 'User works remotely',                               defaultScore: 0.25 },

  // Interests — extended
  { key: 'likes_travel',      description: 'User travels frequently or loves travel',           defaultScore: 0.35 },
  { key: 'likes_dancing',     description: 'User enjoys dancing',                               defaultScore: 0.20 },
  { key: 'likes_comedy',      description: 'User enjoys stand-up comedy or improv',             defaultScore: 0.25 },
  { key: 'likes_art',         description: 'User is interested in art or museums',              defaultScore: 0.20 },
  { key: 'likes_food',        description: 'User is a foodie who cares a lot about food quality', defaultScore: 0.45 },
  { key: 'likes_coffee',      description: 'User frequently references coffee or cafe culture', defaultScore: 0.50 },
  { key: 'plays_poker',       description: 'User plays poker or other card games',              defaultScore: 0.15 },
  { key: 'watches_anime',     description: 'User watches anime',                                defaultScore: 0.20 },
  { key: 'is_gamer',          description: 'User plays video games regularly',                  defaultScore: 0.30 },
  { key: 'likes_true_crime',  description: 'User is interested in true crime or mystery',       defaultScore: 0.20 },

  // Situational / one-off needs
  { key: 'needs_parking_info', description: 'User frequently asks about parking',               defaultScore: 0.20 },
  { key: 'needs_directions',  description: 'User often needs location help or directions',      defaultScore: 0.15 },
  { key: 'needs_childcare',   description: 'User needs to arrange childcare to attend',         defaultScore: 0.05 },
  { key: 'needs_plus_one_approved', description: 'User wants to confirm bringing a guest',     defaultScore: 0.10 },
]

// ─── EMOJI TYPE SEEDS ─────────────────────────────────────────────────────────
// These are upserted into the emoji_types table on startup.
export const EMOJI_TYPE_SEEDS = [
  // Attendance
  { name: 'coming',           emoji: '✅', description: 'User is coming to the event' },
  { name: 'not_coming',       emoji: '❌', description: 'User is not coming to the event' },
  { name: 'maybe',            emoji: '❓', description: 'User might come to the event' },
  { name: 'coming_late',      emoji: '⏰', description: 'User is coming but will be late' },
  { name: 'leaving_early',    emoji: '🏃', description: 'User needs to leave the event early' },

  // Transportation
  { name: 'needs_ride',       emoji: '🚗', description: 'User needs a ride to the event' },
  { name: 'offering_ride',    emoji: '🙌', description: 'User is offering rides to others' },
  { name: 'riding_bike',      emoji: '🚲', description: 'User is biking to the event' },
  { name: 'taking_transit',   emoji: '🚌', description: 'User is taking public transit' },
  { name: 'carpooling',       emoji: '🚙', description: 'User is organizing or joining a carpool' },
  { name: 'has_parking',      emoji: '🅿️', description: 'User has confirmed parking' },

  // Food & Drink
  { name: 'bringing_food',    emoji: '🍕', description: 'User is bringing food to the event' },
  { name: 'bringing_drinks',  emoji: '🥤', description: 'User is bringing drinks to the event' },
  { name: 'bringing_alcohol', emoji: '🍺', description: 'User is bringing alcoholic beverages' },
  { name: 'dietary_need',     emoji: '🥗', description: 'User has a dietary restriction relevant to this event' },
  { name: 'cooking_for_event',emoji: '👨‍🍳', description: 'User is cooking or preparing food for the event' },
  { name: 'ordering_food',    emoji: '📦', description: 'User suggests ordering/delivering food' },
  { name: 'bringing_dessert', emoji: '🍰', description: 'User is bringing dessert or sweets' },

  // Logistics
  { name: 'needs_directions', emoji: '📍', description: 'User needs help finding the venue' },
  { name: 'knows_venue',      emoji: '🗺️', description: 'User is familiar with the location' },
  { name: 'bringing_gear',    emoji: '🎒', description: 'User is bringing equipment or supplies' },
  { name: 'setup_volunteer',  emoji: '🔧', description: 'User is volunteering to help set up' },
  { name: 'cleanup_volunteer',emoji: '🧹', description: 'User is volunteering to help clean up' },
  { name: 'hosting',          emoji: '🏠', description: 'User is hosting the event at their place' },

  // Planning & Coordination
  { name: 'has_question',     emoji: '🙋', description: 'User has a question about the event' },
  { name: 'making_suggestion',emoji: '💡', description: 'User is suggesting an idea or change' },
  { name: 'needs_confirmation',emoji: '📋', description: 'User is waiting on a confirmation or decision' },
  { name: 'coordinating',     emoji: '📞', description: 'User is coordinating logistics with others' },
  { name: 'rsvp_requested',   emoji: '📬', description: 'User is asking others to RSVP' },

  // Mood & Energy
  { name: 'excited',          emoji: '🎉', description: 'User is excited about the event' },
  { name: 'nervous',          emoji: '😬', description: 'User is nervous or anxious about attending' },
  { name: 'hyped',            emoji: '🔥', description: 'User is very enthusiastic, generating hype' },
  { name: 'grateful',         emoji: '🙏', description: 'User is expressing appreciation' },

  // Practical needs
  { name: 'needs_childcare',  emoji: '👶', description: 'User needs to arrange childcare to attend' },
  { name: 'bringing_kids',    emoji: '🧒', description: 'User is bringing children to the event' },
  { name: 'bringing_pet',     emoji: '🐶', description: 'User wants to bring a pet to the event' },
  { name: 'accessibility_need',emoji: '♿', description: 'User has an accessibility or mobility need' },
  { name: 'needs_accommodation',emoji: '🛏️', description: 'User needs overnight accommodation' },

  // Cost & Resources
  { name: 'offering_supplies',emoji: '📦', description: 'User is offering to bring supplies/equipment' },
  { name: 'splitting_cost',   emoji: '💸', description: 'User is discussing splitting costs' },
  { name: 'has_budget_concern',emoji: '💰', description: 'User has expressed a concern about cost' },
  { name: 'bought_ticket',    emoji: '🎟️', description: 'User has purchased or secured a ticket' },

  // Social
  { name: 'bringing_friend',  emoji: '👥', description: 'User is bringing an additional guest' },
  { name: 'wants_to_meet',    emoji: '👋', description: 'User wants to connect with specific people at the event' },
  { name: 'is_new',           emoji: '🆕', description: 'User is new to the group or event' },

  // Weather & Environment
  { name: 'weather_concern',  emoji: '🌧️', description: 'User is worried about weather affecting the event' },
  { name: 'outdoor_event',    emoji: '⛅', description: 'User is noting or asking about outdoor conditions' },

  // Post-event
  { name: 'sharing_photos',   emoji: '📸', description: 'User is sharing or asking for photos from the event' },
  { name: 'recap_needed',     emoji: '📝', description: 'User missed the event and wants a recap' },
]

const MIN_CONFIDENCE = 0.3
const VIEWER_RELEVANCE_THRESHOLD = 0.15
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

export interface SetupPollOptionDraft {
  optionText: string
  optionValue?: string
}

export interface SetupFieldPollDraft {
  field: 'name' | 'location' | 'eventTime' | 'description'
  question: string
  options: SetupPollOptionDraft[]
}

export interface EventSetupAnalysis {
  extracted: {
    name: string | null
    location: string | null
    eventTime: string | null
    description: string | null
  }
  questionPolls: PollDraft[]
  fieldPolls: SetupFieldPollDraft[]
}

interface ClassificationResult {
  attributes: AttrResult[]
  emojis: EmojiResult[]
  viewerRelevance: Record<string, number>
  shouldBePoll: boolean
  pollDraft?: {
    question?: string
    options?: string[]
    allowsMultiple?: boolean
  }
}

interface EventSetupResult {
  extracted?: {
    name?: string
    location?: string
    eventTime?: string
    description?: string
  }
  questionPolls?: Array<{
    question?: string
    options?: string[]
    allowsMultiple?: boolean
  }>
  fieldPolls?: Array<{
    field?: 'name' | 'location' | 'eventTime' | 'description'
    question?: string
    options?: Array<{
      optionText?: string
      optionValue?: string
    }>
  }>
}

export async function processMessageContext(
  messageId: number,
  senderId: number,
  eventId: number,
  content: string,
): Promise<PollDraft | null> {
  try {
    const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { name: true } })
    if (!sender) return null

    const emojiTypes = await prisma.emojiType.findMany()
    const result = await classifyMessage(content, sender.name, emojiTypes)

    // Job A: sender profiling — update UserAttribute + store MessageContextEvidence
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

    // Job B: viewer relevance hashmap — store sparse entries above threshold
    const relevanceEntries = Object.entries(result.viewerRelevance ?? {})
      .filter(([key, score]) => {
        const validKey = ATTRIBUTE_DEFS.find(a => a.key === key)
        return validKey && typeof score === 'number' && score >= VIEWER_RELEVANCE_THRESHOLD
      })

    for (const [attributeKey, score] of relevanceEntries) {
      await prisma.messageViewerRelevance.upsert({
        where: { messageId_attributeKey: { messageId, attributeKey } },
        update: { score },
        create: { messageId, attributeKey, score },
      })
    }

    contextBus.emit('context_updated', { eventId, userId: senderId })
    return sanitizePollDraft(result)
  } catch (err) {
    console.error('[context] processing failed:', err)
    return null
  }
}

export async function analyzeEventSetup(input: {
  groupName: string
  initialMessage: string
}): Promise<EventSetupAnalysis> {
  const todayIso = new Date().toISOString()
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You extract event setup data from a group creator message. Return only valid compact JSON.',
      },
      {
        role: 'user',
        content: `Today: ${todayIso}
Group name: "${input.groupName}"
Initial message: "${input.initialMessage}"

Return JSON:
{"extracted":{"name":string|null,"location":string|null,"eventTime":string|null,"description":string|null},"questionPolls":[{"question":string,"options":string[],"allowsMultiple":boolean}],"fieldPolls":[{"field":"name"|"location"|"eventTime"|"description","question":string,"options":[{"optionText":string,"optionValue":string}]}]}

Rules:
- extracted.name/location/description should be null if the message does not clearly specify them.
- extracted.eventTime must be ISO-8601 or null.
- If the message mentions only a weekday like Friday, resolve it to the next upcoming matching date after Today.
- questionPolls: create one poll for each distinct user-facing decision/question in the initial message. Multiple polls are allowed.
- fieldPolls: for every missing field among name, location, eventTime, description, create exactly one poll with 2-4 realistic options.
- For eventTime field polls, optionValue must be ISO-8601 and optionText should be a human-friendly label.
- For other field polls, optionValue should equal the final chosen text.
- Keep options concise and distinct.`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 900,
  })

  const raw = response.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as EventSetupResult

  const extracted = {
    name: sanitizeTextField(parsed.extracted?.name),
    location: sanitizeTextField(parsed.extracted?.location),
    eventTime: sanitizeIsoDateField(parsed.extracted?.eventTime),
    description: sanitizeTextField(parsed.extracted?.description),
  }

  if (extractClockTimes(input.initialMessage).length > 1) {
    extracted.eventTime = null
  }

  const questionPolls = (parsed.questionPolls ?? [])
    .map((poll) => sanitizePollDraft({
      shouldBePoll: true,
      pollDraft: poll,
    } as ClassificationResult))
    .filter((poll): poll is PollDraft => Boolean(poll))

  const fieldPolls = (parsed.fieldPolls ?? [])
    .map(sanitizeSetupFieldPollDraft)
    .filter((poll): poll is SetupFieldPollDraft => Boolean(poll))

  const promoted = promoteQuestionPollsToFieldPolls({
    questionPolls,
    fieldPolls,
    initialMessage: input.initialMessage,
  })

  const fallbackFieldPolls = buildFallbackSetupFieldPolls({
    groupName: input.groupName,
    initialMessage: input.initialMessage,
    extracted,
    existingFields: new Set([...fieldPolls, ...promoted.fieldPolls].map((poll) => poll.field)),
  })

  return {
    extracted,
    questionPolls: promoted.questionPolls,
    fieldPolls: [...fieldPolls, ...promoted.fieldPolls, ...fallbackFieldPolls],
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

  // Compact attribute list: key=short_description only (saves ~60% tokens vs full descriptions)
  const compactAttrList = ATTRIBUTE_DEFS
    .map(a => `${a.key}=${a.description.split(',')[0].slice(0, 40)}`)
    .join('; ')

  // Core emojis most likely to appear in messages (keep list short to save tokens)
  const coreEmojiList = emojiTypes
    .filter(e => [
      'coming','not_coming','maybe','coming_late','leaving_early',
      'needs_ride','offering_ride','carpooling',
      'bringing_food','bringing_drinks','bringing_alcohol','dietary_need','cooking_for_event',
      'setup_volunteer','cleanup_volunteer','hosting',
      'has_question','making_suggestion','excited','hyped','grateful','nervous',
      'needs_childcare','bringing_kids','bringing_pet','accessibility_need',
      'splitting_cost','has_budget_concern','bought_ticket',
      'bringing_friend','weather_concern','sharing_photos',
    ].includes(e.name))
    .map(e => `${e.id}:${e.name}${e.emoji}`)
    .join(', ')

  const allAttrKeys = ATTRIBUTE_DEFS.map(a => a.key).join(',')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You analyze group event chat. Return only valid compact JSON — no markdown, no trailing commas.`,
      },
      {
        role: 'user',
        content: `Sender: ${senderName}
Message: "${content}"

ATTRS (key=meaning): ${compactAttrList}

EMOJIS (id:name): ${coreEmojiList}

Return this JSON:
{"attributes":[{"key":string,"signal":"positive"|"negative","confidence":number,"quote":string}],"emojis":[{"emojiId":number,"confidence":number,"quote":string}],"viewerRelevance":{"key":score},"shouldBePoll":boolean,"pollDraft":{"question":string,"options":string[],"allowsMultiple":boolean}}

Rules:
- attributes: only clear signals about SENDER, conf>=${MIN_CONFIDENCE}
- emojis: only from emoji list above, conf>=${MIN_CONFIDENCE}
- viewerRelevance: for ALL keys in ATTRS, score 0-1 how relevant msg is to viewer who HAS that attr. Include only scores>=${VIEWER_RELEVANCE_THRESHOLD}. Max 8 entries. Examples: "offering ride"→{has_car:0.9,needs_ride:0.9,can_carpool:0.8}; "not coming"→{is_regular:0.7,is_close_with_organizer:0.6}; "gluten-free food"→{has_dietary_restriction:0.95,has_gluten_intolerance:0.95}
- shouldBePoll: true only for group decisions with 2+ options
- quotes: max ${MAX_QUOTE_CHARS} chars`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 600,
  })

  const raw = response.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as ClassificationResult
  // Ensure viewerRelevance is always an object
  if (!parsed.viewerRelevance || typeof parsed.viewerRelevance !== 'object') {
    parsed.viewerRelevance = {}
  }
  return parsed
}

function trimQuote(quote: string | undefined): string {
  if (!quote) return ''
  const normalized = quote
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return ''
  if (normalized.length < 6) return ''
  if (/^[a-z0-9_]+$/.test(normalized)) return ''

  return normalized.slice(0, MAX_QUOTE_CHARS)
}

function sanitizeTextField(value: string | undefined) {
  if (!value) return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > 0 ? normalized.slice(0, 200) : null
}

function sanitizeIsoDateField(value: string | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function sanitizeSetupFieldPollDraft(
  poll: NonNullable<EventSetupResult['fieldPolls']>[number],
): SetupFieldPollDraft | null {
  if (!poll?.field || !['name', 'location', 'eventTime', 'description'].includes(poll.field)) {
    return null
  }

  const question = sanitizeTextField(poll.question)
  if (!question) return null

  const optionEntries: Array<readonly [string, SetupPollOptionDraft]> = []
  for (const option of poll.options ?? []) {
    const optionText = sanitizeTextField(option.optionText)
    if (!optionText) continue

    if (poll.field === 'eventTime') {
      const optionValue = sanitizeIsoDateField(option.optionValue)
      if (!optionValue) continue
      optionEntries.push([optionValue, { optionText, optionValue }])
      continue
    }

    const optionValue = sanitizeTextField(option.optionValue) ?? optionText
    optionEntries.push([optionValue, { optionText, optionValue }])
  }

  const options = [...new Map<string, SetupPollOptionDraft>(optionEntries).values()].slice(0, 4)

  if (options.length < 2) return null

  return {
    field: poll.field,
    question,
    options,
  }
}

function buildFallbackSetupFieldPolls(input: {
  groupName: string
  initialMessage: string
  extracted: EventSetupAnalysis['extracted']
  existingFields: Set<SetupFieldPollDraft['field']>
}): SetupFieldPollDraft[] {
  const polls: SetupFieldPollDraft[] = []
  const missingFields = (['name', 'location', 'eventTime', 'description'] as const)
    .filter((field) => !input.extracted[field] && !input.existingFields.has(field))

  for (const field of missingFields) {
    if (field === 'name') {
      polls.push({
        field,
        question: 'What should we call this plan?',
        options: [
          { optionText: input.groupName, optionValue: input.groupName },
          { optionText: `${input.groupName} Plan`, optionValue: `${input.groupName} Plan` },
          { optionText: `${input.groupName} Hangout`, optionValue: `${input.groupName} Hangout` },
        ],
      })
    }

    if (field === 'location') {
      polls.push({
        field,
        question: 'Where should this happen?',
        options: [
          { optionText: 'Student Center', optionValue: 'Student Center' },
          { optionText: 'Downtown', optionValue: 'Downtown' },
          { optionText: 'Campus Lawn', optionValue: 'Campus Lawn' },
        ],
      })
    }

    if (field === 'eventTime') {
      const timeOptions = buildFallbackEventTimeOptions(input.initialMessage)
      polls.push({
        field,
        question: 'When should this happen?',
        options: timeOptions,
      })
    }

    if (field === 'description') {
      polls.push({
        field,
        question: 'What kind of plan is this?',
        options: buildFallbackDescriptionOptions(input.initialMessage),
      })
    }
  }

  return polls
}

function promoteQuestionPollsToFieldPolls(input: {
  questionPolls: PollDraft[]
  fieldPolls: SetupFieldPollDraft[]
  initialMessage: string
}) {
  const existingFields = new Set(input.fieldPolls.map((poll) => poll.field))
  const promotedPolls: SetupFieldPollDraft[] = []
  const remainingQuestionPolls: PollDraft[] = []

  for (const poll of input.questionPolls) {
    const field = detectPollField(poll)
    if (!field || existingFields.has(field)) {
      remainingQuestionPolls.push(poll)
      continue
    }

    const setupPoll = toSetupFieldPollDraft(field, poll, input.initialMessage)
    if (!setupPoll) {
      remainingQuestionPolls.push(poll)
      continue
    }

    existingFields.add(field)
    promotedPolls.push(setupPoll)
  }

  return {
    questionPolls: remainingQuestionPolls,
    fieldPolls: promotedPolls,
  }
}

function detectPollField(poll: PollDraft): SetupFieldPollDraft['field'] | null {
  const question = poll.question.toLowerCase()
  const optionBlob = poll.options.join(' ').toLowerCase()

  if (/\b(name|call|title)\b/.test(question)) return 'name'
  if (/\b(where|location|venue)\b/.test(question)) return 'location'
  if (/\b(when|time|start|date)\b/.test(question)) return 'eventTime'
  if (/\b(activity|plan|do)\b/.test(question)) return 'description'
  if (/\b(bowling|karaoke|movie|dinner|coffee|game|hike|picnic)\b/.test(optionBlob)) return 'description'

  return null
}

function toSetupFieldPollDraft(
  field: SetupFieldPollDraft['field'],
  poll: PollDraft,
  initialMessage: string,
): SetupFieldPollDraft | null {
  if (field === 'eventTime') {
    const options: SetupPollOptionDraft[] = []
    for (const optionText of poll.options) {
      const optionValue = buildEventTimeOptionValue(optionText, initialMessage)
      if (!optionValue) continue
      options.push({ optionText, optionValue })
    }

    if (options.length < 2) return null
    return { field, question: poll.question, options }
  }

  const options = poll.options.map((optionText) => ({ optionText, optionValue: optionText }))
  if (options.length < 2) return null
  return { field, question: poll.question, options }
}

function buildEventTimeOptionValue(optionText: string, initialMessage: string) {
  const directIso = sanitizeIsoDateField(optionText)
  if (directIso) return directIso

  const extractedTimes = extractClockTimes(optionText)
  const time = extractedTimes[0]
  if (!time) return null

  const baseDate = extractUpcomingWeekday(initialMessage) ?? new Date(Date.now() + 24 * 60 * 60 * 1000)
  return combineDateAndTime(baseDate, time)
}

function buildFallbackEventTimeOptions(initialMessage: string): SetupPollOptionDraft[] {
  const weekday = extractUpcomingWeekday(initialMessage)
  const times = extractClockTimes(initialMessage)
  const baseDate = weekday ?? new Date(Date.now() + 24 * 60 * 60 * 1000)
  const candidates = (times.length > 0 ? times : ['18:00', '19:00', '20:00']).slice(0, 3)

  return candidates.map((time) => {
    const iso = combineDateAndTime(baseDate, time)
    const labelDate = new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const [hours, minutes] = time.split(':')
    const labelTime = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: minutes === '00' ? undefined : '2-digit' })
    return {
      optionText: `${labelDate} at ${labelTime}`,
      optionValue: iso,
    }
  })
}

function buildFallbackDescriptionOptions(initialMessage: string): SetupPollOptionDraft[] {
  const lower = initialMessage.toLowerCase()
  const options = new Set<string>()

  const keywords: Array<[RegExp, string]> = [
    [/\bbowling\b/, 'Bowling night'],
    [/\bkaraoke\b/, 'Karaoke night'],
    [/\bmovie\b/, 'Movie night'],
    [/\bgame|board game\b/, 'Game night'],
    [/\bdinner|food|eat\b/, 'Dinner meetup'],
    [/\bcoffee|cafe\b/, 'Coffee meetup'],
  ]

  for (const [pattern, label] of keywords) {
    if (pattern.test(lower)) options.add(label)
  }

  options.add('Casual hangout')
  options.add('Group meetup')

  return [...options].slice(0, 4).map((optionText) => ({ optionText, optionValue: optionText }))
}

function extractUpcomingWeekday(message: string) {
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
  const lower = message.toLowerCase()
  const match = weekdays.find((weekday) => lower.includes(weekday))
  if (!match) return null

  const now = new Date()
  const targetDay = weekdays.indexOf(match)
  const next = new Date(now)
  const delta = (targetDay - now.getDay() + 7) % 7 || 7
  next.setDate(now.getDate() + delta)
  next.setHours(0, 0, 0, 0)
  return next
}

function extractClockTimes(message: string) {
  const matches = [...message.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)]
  const times = new Set<string>()

  for (const match of matches) {
    const hour = Number(match[1])
    const minute = Number(match[2] ?? '0')
    const meridiem = match[3]?.toLowerCase()
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || !meridiem) continue

    let normalizedHour = hour % 12
    if (meridiem === 'pm') normalizedHour += 12
    const hh = String(normalizedHour).padStart(2, '0')
    const mm = String(minute).padStart(2, '0')
    times.add(`${hh}:${mm}`)
  }

  return [...times]
}

function combineDateAndTime(date: Date, time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const combined = new Date(date)
  combined.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  return combined.toISOString()
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
