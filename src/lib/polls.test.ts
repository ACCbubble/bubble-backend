import test from "node:test"
import assert from "node:assert/strict"
import { formatPollState, normalizeVoteSelection } from "./polls.js"

test("normalizeVoteSelection keeps unique valid ids", () => {
  const ids = normalizeVoteSelection({
    allowsMultiple: true,
    optionIds: [2, 2, 3, -1, 0, 4],
  })

  assert.deepEqual(ids, [2, 3, 4])
})

test("normalizeVoteSelection rejects multiple ids for single-select polls", () => {
  assert.throws(() => normalizeVoteSelection({
    allowsMultiple: false,
    optionIds: [1, 2],
  }))
})

test("formatPollState exposes viewer selections and percentages", () => {
  const state = formatPollState({
    id: 7,
    group_id: 1,
    user_id: 12,
    question: "Who can bring snacks?",
    created_at: new Date("2026-04-20T10:00:00Z"),
    expires_at: null,
    is_active: true,
    allows_multiple: true,
    options: [
      {
        id: 10,
        option_text: "I can",
        votes: [
          { id: 1, user_id: 3, option_id: 10 },
          { id: 2, user_id: 4, option_id: 10 },
        ],
      },
      {
        id: 11,
        option_text: "Maybe",
        votes: [
          { id: 3, user_id: 3, option_id: 11 },
        ],
      },
    ],
  }, 3)

  assert.equal(state.totalVoters, 2)
  assert.deepEqual(state.viewerVoteOptionIds, [10, 11])
  assert.equal(state.options[0]?.percentage, 100)
  assert.equal(state.options[1]?.percentage, 50)
  assert.equal(state.options[1]?.selectedByViewer, true)
})
