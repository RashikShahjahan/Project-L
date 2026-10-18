import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAction } from '../src/game/engine.js'
import { observe } from '../src/game/observation.js'
import { createGame } from '../src/game/setup.js'
import type { GameState } from '../src/game/state.js'

const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]

test('mutating a public observation cannot change authoritative state or another player view', () => {
  const state = createGame({ players, seed: 3 })
  const original = structuredClone(state)
  const view = observe(state, 'a')
  Reflect.set(view.players[0].supply, 'single', 999)
  Reflect.set(view.players[0].unfinished, '0', { puzzleId: 'base-01', placements: [] })
  Reflect.set(view.market.white, '0', null)
  Reflect.set(view.reserve, 'single', 999)
  assert.deepEqual(state, original)
  assert.deepEqual(observe(state, 'b'), observe(original, 'b'))
})

test('observations show every supply but hide opponents’ completed puzzles unless scores are visible', () => {
  const base = createGame({ players, seed: 3 })
  const state = {
    ...base,
    players: base.players.map((player, index) => ({ ...player, completed: index === 0 ? ['base-01'] as const : [] })),
  } as GameState
  const hidden = observe(state, 'b')
  assert.deepEqual(hidden.players[0].supply, state.players[0].supply)
  assert.equal(hidden.players[0].completed, undefined)
  assert.deepEqual(hidden.players[1].completed, [])

  const visibleBase = createGame({ players, seed: 3, visibleScores: true })
  const visible = { ...visibleBase, players: state.players } as GameState
  assert.deepEqual(observe(visible, 'b').players[0].completed, ['base-01'])
  const scored: GameState = { ...state, phase: 'scored', results: [], winnerIds: [] }
  assert.deepEqual(observe(scored, 'b').players[0].completed, ['base-01'])
  const payload = JSON.stringify(observe(scored, 'b'))
  assert.equal(payload.includes('"random"'), false)
  assert.equal(payload.includes('"decks"'), false)
})

test('Recycle remains available when the active player already has four unfinished puzzles', () => {
  const base = createGame({ players, seed: 9 })
  if (base.phase !== 'turns') throw new Error('Expected normal turn phase')
  const activeId = base.turn.activePlayerId
  const state = {
    ...base,
    players: base.players.map((player) => player.id === activeId
      ? { ...player, unfinished: ['base-01', 'base-02', 'base-03', 'base-04'].map((puzzleId) => ({ puzzleId, placements: [] })) }
      : player),
  } as GameState
  for (const deck of ['white', 'black'] as const) {
    const bottomOrder = state.market[deck].filter((id): id is NonNullable<typeof id> => id !== null)
    assert.doesNotThrow(() => applyAction(state, { type: 'recycle', deck, bottomOrder }))
    assert.throws(() => applyAction(state, { type: 'take', source: 'deck', deck }))
  }
})
