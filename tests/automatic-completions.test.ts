import assert from 'node:assert/strict'
import { test } from 'node:test'
import { automaticCompletionDecision, resolveAutomaticCompletions } from '../src/game/automatic-completions.js'
import { applyAction, chooseCompletionOrder } from '../src/game/engine.js'
import { createGame } from '../src/game/setup.js'
import { createInventory, PIECE_IDS } from '../src/game/pieces.js'
import { getPuzzle } from '../src/game/puzzles.js'
import type { PuzzleId } from '../src/game/puzzles.js'
import type { GameState, Placement } from '../src/game/state.js'

type Mutable<T> = T extends readonly unknown[]
  ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T
type MutableTurnGameState = Mutable<Extract<GameState, { phase: 'turns' }>>

/** Completed-puzzle fixtures expose only the mutable fields each boundary case needs. */
function completedFixture(ids: PuzzleId[], actionsRemaining: 0 | 1 | 2 | 3 = 2): MutableTurnGameState {
  const created = createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 2026 })
  if (created.phase !== 'turns') throw new Error('Expected initial turns phase')
  const state = structuredClone(created) as MutableTurnGameState
  state.turn.activePlayerId = 'a'
  state.turn.actionsRemaining = actionsRemaining
  state.turn.completion = { status: 'choose-order', puzzleIds: ids }
  state.players[0].supply = createInventory()
  state.players[0].unfinished = ids.map((puzzleId) => ({ puzzleId, placements: getPuzzle(puzzleId).shape.cells.map((origin): Placement => ({ piece: 'single', orientation: 0, origin })) }))
  return state
}

test('single completion returns pieces and the only reward before the next action', () => {
  const state = completedFixture(['base-09'], 2)
  const reserveBefore = state.reserve.single
  const resolved = resolveAutomaticCompletions(state)
  assert.equal(resolved.phase, 'turns')
  if (resolved.phase !== 'turns') return
  assert.deepEqual(resolved.turn.completion, { status: 'none' })
  assert.equal(resolved.turn.actionsRemaining, 2)
  assert.equal(resolved.turn.activePlayerId, 'a')
  assert.deepEqual(resolved.players[0].completed, ['base-09'])
  assert.equal(resolved.players[0].unfinished.length, 0)
  assert.equal(resolved.players[0].supply.single, getPuzzle('base-09').shape.cells.length + 1)
  assert.equal(resolved.reserve.single, reserveBefore - 1)
  assert.doesNotThrow(() => applyAction(resolved, { type: 'upgrade', kind: 'new', piece: 'single' }))
})

test('automatic rewards on the last action finish before switching players', () => {
  const resolved = resolveAutomaticCompletions(completedFixture(['base-09'], 0))
  assert.equal(resolved.phase, 'turns')
  if (resolved.phase !== 'turns') return
  assert.equal(resolved.turn.activePlayerId, 'b')
  assert.equal(resolved.turn.actionsRemaining, 3)
  assert.deepEqual(resolved.players[0].completed, ['base-09'])
  assert.ok(resolved.players[0].supply.single > 0)
})

test('multiple completions keep the order decision, then skip deterministic rewards', () => {
  const state: GameState = completedFixture(['base-09', 'base-11'])
  assert.equal(automaticCompletionDecision(state.phase === 'turns' ? state.turn.completion : null), null)
  assert.equal(resolveAutomaticCompletions(state), state)
  const resolved = resolveAutomaticCompletions(chooseCompletionOrder(state, ['base-11', 'base-09']))
  assert.deepEqual(resolved.players[0].completed, ['base-11', 'base-09'])
  assert.equal(resolved.phase === 'turns' && resolved.turn.actionsRemaining, 2)
})

test('reserve shortages retain real reward choices and handle an empty reserve automatically', () => {
  const state = completedFixture(['base-11'])
  state.reserve.domino = 0
  const waiting = resolveAutomaticCompletions(state)
  assert.equal(waiting.phase, 'turns')
  if (waiting.phase !== 'turns' || waiting.turn.completion.status !== 'resolve-rewards') return assert.fail('Expected a fallback reward choice')
  assert.ok(waiting.turn.completion.candidates.length > 1)
  assert.equal(automaticCompletionDecision(waiting.turn.completion), null)
  assert.equal(waiting.players[0].completed.length, 0)
  assert.throws(() => applyAction(waiting, { type: 'upgrade', kind: 'new', piece: 'single' }))

  state.reserve = createInventory()
  const resolved = resolveAutomaticCompletions(state)
  assert.deepEqual(resolved.players[0].completed, ['base-11'])
  assert.equal(resolved.players[0].supply.single, getPuzzle('base-11').shape.cells.length)
  assert.ok(PIECE_IDS.every((piece) => resolved.reserve[piece] === 0))
})

test('a unique reserve fallback is automatic, without choosing the unavailable shape', () => {
  const state = completedFixture(['base-13'])
  state.reserve['tri-corner'] = 0
  const resolved = resolveAutomaticCompletions(state)
  assert.deepEqual(resolved.players[0].completed, ['base-13'])
  assert.equal(resolved.players[0].supply['tri-line'], 1)
  assert.equal(resolved.players[0].supply['tri-corner'], 0)
  assert.equal(resolved.reserve['tri-line'], state.reserve['tri-line'] - 1)
})
