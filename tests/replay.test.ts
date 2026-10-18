import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyDecision, createReplay, stateHash, verifyReplay } from '../src/game/replay.js'
import type { ReplayDecision } from '../src/game/replay.js'
import { createGame } from '../src/game/setup.js'

test('recorded decisions replay deterministically and detect altered transitions or final state', () => {
  const initial = createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 17 })
  const decisions: ReplayDecision[] = [
    { type: 'action', action: { type: 'take', source: 'market', deck: 'white', slot: 0 } },
    { type: 'action', action: { type: 'upgrade', kind: 'new', piece: 'single' } },
    { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } },
  ]
  let state = initial
  const entries = decisions.map((decision) => {
    state = applyDecision(state, decision)
    return { decision, stateHash: stateHash(state) }
  })
  const replay = createReplay(initial, entries, state)
  assert.deepEqual(verifyReplay(replay), state)
  assert.throws(() => verifyReplay({
    ...replay,
    decisions: entries.map((entry, index) => index === 0 ? { ...entry, stateHash: 'altered' } : entry),
  }), /diverged after decision 1/)
  assert.throws(() => verifyReplay({
    ...replay,
    finalState: { ...state, config: { ...state.config, visibleScores: !state.config.visibleScores } },
  }), /final state/)
})
