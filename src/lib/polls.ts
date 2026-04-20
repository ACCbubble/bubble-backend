export interface PollOptionRecord {
  id: number
  option_text: string | null
  votes: Array<{ id: number; user_id: number | null; option_id: number | null }>
}

export interface PollRecord {
  id: number
  event_id: number | null
  user_id: number | null
  question: string | null
  created_at: Date | null
  expires_at: Date | null
  is_active: boolean | null
  allows_multiple: boolean | null
  options: PollOptionRecord[]
}

export function normalizeVoteSelection(input: {
  allowsMultiple: boolean
  optionId?: number
  optionIds?: number[]
}) {
  const raw = input.optionIds ?? (input.optionId !== undefined ? [input.optionId] : [])
  const normalized = [...new Set(raw.filter((value) => Number.isInteger(value) && value > 0))]

  if (!input.allowsMultiple && normalized.length > 1) {
    throw new Error("Single-select polls accept exactly one option")
  }

  return normalized
}

export function formatPollState(poll: PollRecord, viewerUserId?: number | null) {
  const viewerVoteOptionIds = poll.options
    .filter((option) => option.votes.some((vote) => vote.user_id === viewerUserId))
    .map((option) => option.id)

  const voterIds = new Set<number>()
  for (const option of poll.options) {
    for (const vote of option.votes) {
      if (typeof vote.user_id === "number") voterIds.add(vote.user_id)
    }
  }

  const totalVoters = voterIds.size
  const expiresAt = poll.expires_at
  const isExpired = Boolean(expiresAt && expiresAt.getTime() < Date.now())
  const isActive = poll.is_active !== false && !isExpired

  return {
    id: poll.id,
    eventId: poll.event_id,
    userId: poll.user_id,
    question: poll.question,
    createdAt: poll.created_at,
    expiresAt,
    isActive,
    isExpired,
    allowsMultiple: Boolean(poll.allows_multiple),
    totalVoters,
    viewerVoteOptionIds,
    options: poll.options.map((option) => {
      const voteCount = option.votes.length
      const percentage = totalVoters > 0 ? Math.round((voteCount / totalVoters) * 100) : 0
      return {
        id: option.id,
        optionText: option.option_text,
        voteCount,
        percentage,
        selectedByViewer: viewerVoteOptionIds.includes(option.id),
      }
    }),
  }
}
