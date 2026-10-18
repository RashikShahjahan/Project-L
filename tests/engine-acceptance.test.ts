import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PIECES, PIECE_IDS, PUZZLES, acquisitionCandidates, applyAction, chooseCompletionOrder, createGame,
  createInventory, finishTouches, isPieceInventoryConserved, legalPlacements,
  resolveCompletionReward,
} from '../src/game/index.js'
import type { GameState, MarketRow, Placement, PlayerState, PuzzleId, TurnState } from '../src/game/index.js'

const seats = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
const singleAt = (y: number): Placement => ({ piece: 'single', orientation: 0, origin: { x: 0, y } })

type Mutable<T> = T extends readonly unknown[]
  ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T
type MutableTurnGameState = Mutable<Extract<GameState, { phase: 'turns' }>>
type MutableFinishingTouchesState = Mutable<Extract<GameState, { phase: 'finishing-touches' }>>

/** Tests use small, explicit states to exercise otherwise rare deck and reserve boundaries. */
function fixture(count: 2 | 3 = 2): MutableTurnGameState {
  const created = createGame({ players: seats.slice(0, count), seed: 23 })
  if (created.phase !== 'turns') throw new Error('Expected initial turns phase')
  const state = structuredClone(created) as MutableTurnGameState
  state.firstPlayerId = 'a'
  state.turn.activePlayerId = 'a'
  state.turn.round = 1
  state.turn.actionsRemaining = 3
  return state
}

function player(state: GameState, id = 'a'): PlayerState {
  const found = state.players.find((item) => item.id === id)
  if (!found) throw new Error(`Unknown player ${id}`)
  return found
}
function mutablePlayer(state: MutableTurnGameState | MutableFinishingTouchesState, id = 'a'): Mutable<PlayerState> {
  const found = state.players.find((item) => item.id === id)
  if (!found) throw new Error(`Unknown player ${id}`)
  return found
}
function turn(state: GameState): TurnState {
  if (state.phase !== 'turns') throw new Error('Expected turns phase')
  return state.turn
}
function putPuzzle(state: MutableTurnGameState | MutableFinishingTouchesState, id: PuzzleId, placements: Placement[] = []): void {
  mutablePlayer(state).unfinished.push({ puzzleId: id, placements })
}
function whitePuzzleIds(): PuzzleId[] { return Array.from({ length: 32 }, (_, i) => `base-${String(i + 1).padStart(2, '0')}` as PuzzleId) }
function blackPuzzleIds(): PuzzleId[] { return Array.from({ length: 20 }, (_, i) => `base-${String(i + 33).padStart(2, '0')}` as PuzzleId) }
function asRow(ids: readonly (PuzzleId | null)[]): Mutable<MarketRow> { return [ids[0] ?? null, ids[1] ?? null, ids[2] ?? null, ids[3] ?? null] }
function setRows(state: MutableTurnGameState, white: readonly (PuzzleId | null)[] = asRow(whitePuzzleIds().slice(0, 4)), black: readonly (PuzzleId | null)[] = asRow(blackPuzzleIds().slice(0, 4))): void {
  state.market = { white: asRow(white), black: asRow(black) }
}
function finishingFixture(state = fixture()): MutableFinishingTouchesState {
  const { turn: _turn, ...shared } = state
  return { ...shared, phase: 'finishing-touches', activePlayerId: 'a' }
}
function burnTurnActions(state: GameState): GameState {
  let next = state
  const activePlayerId = next.phase === 'turns' ? next.turn.activePlayerId : null
  while (next.phase === 'turns' && next.turn.activePlayerId === activePlayerId
    && next.turn.actionsRemaining > 0 && next.turn.completion.status === 'none') {
    const row = next.market.white.filter((id): id is PuzzleId => id !== null)
    next = applyAction(next, { type: 'recycle', deck: 'white', bottomOrder: row })
  }
  return next
}

test('four-puzzle cap, completion slot release, blind draw, and market replacement', () => {
  const full = fixture()
  setRows(full)
  putPuzzle(full, 'base-01'); putPuzzle(full, 'base-02'); putPuzzle(full, 'base-03'); putPuzzle(full, 'base-04')
  assert.throws(() => applyAction(full, { type: 'take', source: 'market', deck: 'white', slot: 0 }))

  const free = fixture()
  setRows(free)
  putPuzzle(free, 'base-09', [singleAt(0)])
  mutablePlayer(free).supply.single = 1
  const completed = applyAction(free, { type: 'place', puzzleId: 'base-09', placement: singleAt(1) })
  assert.equal(completed.phase, 'turns')
  const resolved = resolveCompletionReward(chooseCompletionOrder(completed, ['base-09']), 'single')
  assert.equal(player(resolved).unfinished.length, 0)
  const drawn = applyAction(resolved, { type: 'take', source: 'deck', deck: 'white' })
  assert.equal(player(drawn).unfinished.length, 1)
  assert.deepEqual(drawn.market.white, free.market.white)

  const marketTake = applyAction(fixture(), { type: 'take', source: 'market', deck: 'white', slot: 0 })
  assert.equal(marketTake.market.white[0], fixture().decks.white[0])
  assert.equal(marketTake.decks.white.length, fixture().decks.white.length - 1)
})

test('recycle keeps the chosen future draw order and reveals without shuffling', () => {
  const state = fixture()
  const row = whitePuzzleIds().slice(0, 4)
  const deck = whitePuzzleIds().slice(4, 8)
  setRows(state, row)
  state.decks.white = deck
  const next = applyAction(state, { type: 'recycle', deck: 'white', bottomOrder: [row[2], row[0], row[3], row[1]] as PuzzleId[] })
  assert.deepEqual(next.market.white, deck)
  assert.deepEqual(next.decks.white, [row[2], row[0], row[3], row[1]])
})

test('upgrade exchange supports same-level changes, downgrades, and return-before-fallback', () => {
  const state = fixture()
  state.reserve['tri-line'] = 0
  mutablePlayer(state).supply['tet-line'] = 1
  const exchanged = applyAction(state, { type: 'upgrade', kind: 'exchange', returnPiece: 'tet-line', requestedPiece: 'tri-line', piece: 'tri-corner' })
  assert.equal(player(exchanged).supply['tet-line'], 0)
  assert.equal(player(exchanged).supply['tri-corner'], 1)
  assert.equal(exchanged.reserve['tet-line'], state.reserve['tet-line'] + 1)

  const onlyReturned = fixture()
  onlyReturned.reserve = { ...createInventory(), 'tet-line': 0 }
  mutablePlayer(onlyReturned).supply['tet-line'] = 1
  assert.equal(acquisitionCandidates({ ...createInventory(), 'tet-line': 1 }, 'tet-line')[0], 'tet-line')
  const fallback = applyAction(onlyReturned, { type: 'upgrade', kind: 'exchange', returnPiece: 'tet-line', requestedPiece: 'tet-line', piece: 'tet-line' })
  assert.equal(player(fallback).supply['tet-line'], 1)
  assert.equal(fallback.reserve['tet-line'], 0)
})

test('exchange allows every lower level and rejects exchanges above the next level', () => {
  for (const returnPiece of PIECE_IDS) for (const requestedPiece of PIECE_IDS) {
    const state = fixture()
    mutablePlayer(state).supply[returnPiece] += 1
    state.reserve[returnPiece] -= 1
    const action = { type: 'upgrade', kind: 'exchange', returnPiece, requestedPiece, piece: requestedPiece } as const
    if (PIECES[requestedPiece].level > PIECES[returnPiece].level + 1) {
      assert.throws(() => applyAction(state, action))
      continue
    }
    const next = applyAction(state, action)
    for (const id of PIECE_IDS) {
      const delta = Number(id === requestedPiece) - Number(id === returnPiece)
      assert.equal(player(next).supply[id], player(state).supply[id] + delta)
      assert.equal(next.reserve[id], state.reserve[id] - delta)
    }
    assert.equal(turn(next).actionsRemaining, 2)
    assert.ok(isPieceInventoryConserved(next))
  }
})

test('version 2.5 reserve fallback respects same-level priority and empty levels', () => {
  const reserve = { ...createInventory() }
  reserve['tri-line'] = 0
  reserve.single = 2
  reserve.domino = 2
  reserve['tri-corner'] = 2
  reserve['tet-line'] = 2
  assert.deepEqual(acquisitionCandidates(reserve, 'tri-line'), ['tri-corner'])
  reserve['tri-corner'] = 0
  assert.deepEqual(acquisitionCandidates(reserve, 'tri-line'), ['single', 'domino', 'tet-line'])
  reserve.single = 0; reserve.domino = 0
  assert.deepEqual(acquisitionCandidates(reserve, 'single'), ['tet-line'])
  reserve['tet-line'] = 0
  reserve['tri-line'] = 1
  reserve['tri-corner'] = 1
  assert.deepEqual(acquisitionCandidates(reserve, 'tet-line'), ['tri-line', 'tri-corner'])
  assert.deepEqual(acquisitionCandidates(createInventory(), 'single'), [])
})

test('new-piece Upgrade rejects an empty reserve without spending an action', () => {
  const state = fixture()
  state.reserve = createInventory()
  const before = structuredClone(state)
  assert.throws(() => applyAction(state, { type: 'upgrade', kind: 'new', piece: 'single' }))
  assert.deepEqual(state, before)
})

test('reflected placements are legal; out-of-region, overlap, and absent-piece placements fail', () => {
  const state = fixture()
  putPuzzle(state, 'base-09')
  const reflected = { piece: 'domino', orientation: 1, origin: { x: 0, y: 0 } } as Placement
  mutablePlayer(state).supply.domino = 1
  assert.ok(legalPlacements(player(state), 'base-09', 'domino').some((p) => p.orientation === reflected.orientation))
  assert.doesNotThrow(() => applyAction(state, { type: 'place', puzzleId: 'base-09', placement: reflected }))
  assert.throws(() => applyAction(state, { type: 'place', puzzleId: 'base-09', placement: singleAt(2) }))

  const overlap = fixture()
  putPuzzle(overlap, 'base-09', [singleAt(0)])
  mutablePlayer(overlap).supply.single = 1
  assert.throws(() => applyAction(overlap, { type: 'place', puzzleId: 'base-09', placement: singleAt(0) }))
  mutablePlayer(overlap).supply.single = 0
  assert.throws(() => applyAction(overlap, { type: 'place', puzzleId: 'base-09', placement: singleAt(1) }))

  const reflectedPuzzle = fixture()
  const reflectedCandidate = PUZZLES.find((puzzle) => {
    const candidatePlayer = { ...player(reflectedPuzzle), supply: { ...player(reflectedPuzzle).supply, 'tet-l': 1 }, unfinished: [{ puzzleId: puzzle.id, placements: [] }] }
    return legalPlacements(candidatePlayer, puzzle.id, 'tet-l').some((placement) => placement.orientation >= 4)
  })
  assert.ok(reflectedCandidate)
  putPuzzle(reflectedPuzzle, reflectedCandidate.id)
  mutablePlayer(reflectedPuzzle).supply['tet-l'] = 1
  const reflectedL = legalPlacements(player(reflectedPuzzle), reflectedCandidate.id, 'tet-l').find((placement) => placement.orientation >= 4)
  assert.ok(reflectedL)
  assert.doesNotThrow(() => applyAction(reflectedPuzzle, { type: 'place', puzzleId: reflectedCandidate.id, placement: reflectedL }))
})

test('normal completion returns placed pieces, grants reward, and frees the puzzle', () => {
  const state = fixture()
  putPuzzle(state, 'base-09', [singleAt(0)])
  state.reserve.single -= 1
  mutablePlayer(state).supply.single = 1
  const placed = applyAction(state, { type: 'place', puzzleId: 'base-09', placement: singleAt(1) })
  assert.equal(turn(placed).completion.status, 'choose-order')
  const pending = chooseCompletionOrder(placed, ['base-09'])
  assert.equal(turn(pending).completion.status, 'resolve-rewards')
  const done = resolveCompletionReward(pending, 'single')
  assert.deepEqual(player(done).completed, ['base-09'])
  assert.equal(player(done).supply.single, 3)
  assert.equal(player(done).unfinished.length, 0)
  assert.equal(turn(done).actionsRemaining, 2)
  assert.ok(isPieceInventoryConserved(done))
})

test('Master is atomic, targets each puzzle once, cannot reuse returned pieces, and is once per turn', () => {
  const state = fixture()
  putPuzzle(state, 'base-09', [singleAt(0)])
  putPuzzle(state, 'base-22', [singleAt(0)])
  mutablePlayer(state).supply.single = 1
  assert.throws(() => applyAction(state, { type: 'master', placements: [
    { puzzleId: 'base-09', placement: singleAt(1) },
    { puzzleId: 'base-22', placement: singleAt(1) },
  ] }))
  assert.throws(() => applyAction(state, { type: 'master', placements: [
    { puzzleId: 'base-09', placement: singleAt(1) },
    { puzzleId: 'base-09', placement: singleAt(1) },
  ] }))
  const empty = applyAction(state, { type: 'master', placements: [] })
  assert.equal(turn(empty).masterUsed, true)
  assert.equal(turn(empty).actionsRemaining, 2)
  assert.throws(() => applyAction(empty, { type: 'master', placements: [] }))

  const zero = fixture()
  const emptyMaster = applyAction(zero, { type: 'master', placements: [] })
  assert.equal(turn(emptyMaster).masterUsed, true)
  assert.equal(turn(emptyMaster).actionsRemaining, 2)
})

test('simultaneous completion requires a permutation and resolves rewards sequentially', () => {
  const state = fixture()
  putPuzzle(state, 'base-09', [singleAt(0)])
  putPuzzle(state, 'base-22', [singleAt(0)])
  mutablePlayer(state).supply.single = 2
  state.reserve = { ...createInventory(15), single: 1, domino: 0 }
  const completed = applyAction(state, { type: 'master', placements: [
    { puzzleId: 'base-09', placement: singleAt(1) },
    { puzzleId: 'base-22', placement: singleAt(1) },
  ] })
  assert.throws(() => chooseCompletionOrder(completed, ['base-09', 'base-09']))
  assert.throws(() => applyAction(completed, { type: 'recycle', deck: 'white', bottomOrder: completed.market.white.filter((id): id is PuzzleId => id !== null) }))
  const first = chooseCompletionOrder(completed, ['base-22', 'base-09'])
  assert.equal(turn(first).completion.status, 'resolve-rewards')
  const second = resolveCompletionReward(first, 'single')
  assert.equal(turn(second).completion.status, 'resolve-rewards')
  const nextReward = turn(second).completion
  if (nextReward.status !== 'resolve-rewards') throw new Error('Expected next reward resolution')
  assert.deepEqual(nextReward.candidates, ['tri-line', 'tri-corner'])
  const done = resolveCompletionReward(second, 'tri-corner')
  assert.deepEqual(player(done).completed, ['base-22', 'base-09'])
  assert.equal(player(done).supply.single, 5)
})

test('black-deck exhaustion schedules exactly one full extra round for early and late triggers', () => {
  for (const triggeringPlayer of ['b', 'c']) {
    const state = fixture(3)
    state.turn.activePlayerId = triggeringPlayer
    state.turn.round = 5
    state.market.black = [blackPuzzleIds()[0], blackPuzzleIds()[1], blackPuzzleIds()[2], blackPuzzleIds()[3]]
    state.decks.black = [blackPuzzleIds()[4]]
    let triggered = applyAction(state, { type: 'take', source: 'market', deck: 'black', slot: 0 })
    assert.deepEqual(triggered.endgame, { triggerRound: 5, finalRound: 6 })
    assert.equal(turn(triggered).blackTakesAfterTrigger, 0)
    triggered = burnTurnActions(triggered)
    assert.equal(triggered.phase, 'turns')
    if (triggeringPlayer === 'b') assert.equal(turn(triggered).activePlayerId, 'c')
    else assert.equal(turn(triggered).round, 6)
    while (triggered.phase === 'turns') triggered = burnTurnActions(triggered)
    assert.equal(triggered.phase, 'finishing-touches')
    assert.equal(triggered.activePlayerId, 'a')
    for (const p of triggered.players) assert.equal(p.finishingTouches.committed, false)
  }
})

test('rounds start with the chosen first player and all seats receive equal turns', () => {
  const allSeats = [...seats, { id: 'd', name: 'D' }]
  for (const count of [2, 3, 4]) for (let firstIndex = 0; firstIndex < count; firstIndex += 1) {
    const players = allSeats.slice(0, count)
    let seed = 0
    while (seed < 200 && createGame({ players, seed }).firstPlayerId !== players[firstIndex].id) seed += 1
    assert.ok(seed < 200, 'Find a real seeded setup for every starting seat')
    for (let triggerOffset = 0; triggerOffset < count; triggerOffset += 1) {
      let state = createGame({ players, seed })
      // Isolate the last-draw boundary while retaining the actual seating and first player.
      state = { ...state, decks: { ...state.decks, black: state.decks.black.slice(0, 1) } }
      const turns = Object.fromEntries(players.map(({ id }) => [id, 0]))
      for (const round of [1, 2, 3]) for (let offset = 0; offset < count; offset += 1) {
        assert.equal(state.phase, 'turns')
        if (state.phase !== 'turns') throw new Error('Game ended before every player finished')
        const expected = players[(firstIndex + offset) % count].id
        assert.equal(state.turn.activePlayerId, expected)
        assert.equal(state.turn.round, round)
        turns[expected] += 1
        if (round === 2 && offset === triggerOffset) {
          state = applyAction(state, { type: 'take', source: 'deck', deck: 'black' })
          assert.deepEqual(state.endgame, { triggerRound: 2, finalRound: 3 })
        }
        state = burnTurnActions(state)
      }
      assert.equal(state.phase, 'finishing-touches')
      if (state.phase !== 'finishing-touches') throw new Error('Expected Finishing Touches after the final round')
      assert.equal(state.activePlayerId, players[firstIndex].id)
      assert.deepEqual(Object.values(turns), Array(count).fill(3))
    }
  }
})

test('triggering black Take is uncounted; one later black Take leaves a vacancy', () => {
  const state = fixture()
  state.market.black = [blackPuzzleIds()[0], blackPuzzleIds()[1], blackPuzzleIds()[2], blackPuzzleIds()[3]]
  state.decks.black = [blackPuzzleIds()[4]]
  const trigger = applyAction(state, { type: 'take', source: 'market', deck: 'black', slot: 0 })
  assert.equal(trigger.market.black[0], blackPuzzleIds()[4])
  const postTrigger = applyAction(trigger, { type: 'take', source: 'market', deck: 'black', slot: 1 })
  assert.equal(postTrigger.market.black[1], null)
  assert.equal(turn(postTrigger).blackTakesAfterTrigger, 1)
  assert.throws(() => applyAction(postTrigger, { type: 'take', source: 'market', deck: 'black', slot: 2 }))
})

test('blind draw of the last black puzzle triggers with the same uncounted exception', () => {
  const state = fixture()
  const row = [blackPuzzleIds()[0], blackPuzzleIds()[1], blackPuzzleIds()[2], blackPuzzleIds()[3]] as const
  state.market.black = asRow(row)
  state.decks.black = [blackPuzzleIds()[4]]
  const trigger = applyAction(state, { type: 'take', source: 'deck', deck: 'black' })
  assert.deepEqual(trigger.market.black, row)
  assert.equal(turn(trigger).blackTakesAfterTrigger, 0)
  const next = applyAction(trigger, { type: 'take', source: 'market', deck: 'black', slot: 0 })
  assert.equal(turn(next).blackTakesAfterTrigger, 1)
})

test('post-trigger Recycle preserves the ending and counter; next turn resets the counter', () => {
  const state = fixture()
  state.endgame = { triggerRound: 1, finalRound: 2 }
  state.turn.blackTakesAfterTrigger = 1
  state.market.black = [blackPuzzleIds()[0], blackPuzzleIds()[1], blackPuzzleIds()[2], null]
  state.decks.black = []
  const recycled = applyAction(state, { type: 'recycle', deck: 'black', bottomOrder: state.market.black.filter((id): id is PuzzleId => id !== null) })
  assert.deepEqual(recycled.market.black, state.market.black)
  assert.deepEqual(recycled.endgame, state.endgame)
  assert.equal(turn(recycled).blackTakesAfterTrigger, 1)
  const advanced = burnTurnActions(recycled)
  assert.equal(advanced.phase, 'turns')
  assert.equal(turn(advanced).blackTakesAfterTrigger, 0)
})

test('white exhaustion leaves vacancies, rejects blind draws, and empty recycle spends an action', () => {
  const state = fixture()
  const row = whitePuzzleIds().slice(0, 4)
  state.market.white = asRow(row)
  state.decks.white = []
  const taken = applyAction(state, { type: 'take', source: 'market', deck: 'white', slot: 0 })
  assert.equal(taken.market.white[0], null)
  assert.equal(taken.endgame, null)
  assert.throws(() => applyAction(taken, { type: 'take', source: 'deck', deck: 'white' }))
  const recycled = applyAction(taken, { type: 'recycle', deck: 'white', bottomOrder: row.slice(1) })
  assert.deepEqual(recycled.market.white, [row[1], row[2], row[3], null])
  assert.deepEqual(recycled.decks.white, [])

  const empty = fixture()
  empty.market.white = [null, null, null, null]
  empty.decks.white = []
  const noOp = applyAction(empty, { type: 'recycle', deck: 'white', bottomOrder: [] })
  assert.equal(turn(noOp).actionsRemaining, 2)
  const noOp2 = applyAction(noOp, { type: 'recycle', deck: 'white', bottomOrder: [] })
  const noOp3 = applyAction(noOp2, { type: 'recycle', deck: 'white', bottomOrder: [] })
  assert.equal(turn(noOp3).activePlayerId, 'b')
})

test('Finishing Touches delays returns until commit, grants no reward, and scores deductions', () => {
  const state = finishingFixture()
  putPuzzle(state, 'base-09', [singleAt(0)])
  state.reserve.single -= 1
  mutablePlayer(state).supply.single = 1
  const beforeReward = state.reserve.single
  const next = finishTouches(state, [{ puzzleId: 'base-09', placement: singleAt(1) }])
  assert.equal(next.phase, 'finishing-touches')
  assert.equal(next.activePlayerId, 'b')
  assert.equal(player(next).supply.single, 2)
  assert.equal(next.reserve.single, beforeReward)
  assert.deepEqual(player(next).completed, ['base-09'])
  assert.equal(player(next).finishingTouches.piecesPlaced, 1)
  const scored = finishTouches(next, [])
  assert.equal(scored.phase, 'scored')
  if (scored.phase !== 'scored') throw new Error('Expected scoring')
  assert.equal(scored.results.find((result) => result.playerId === 'a')?.total, 0)
})

test('Finishing Touches cannot reuse a piece returned by an earlier completion in the batch', () => {
  const state = finishingFixture()
  putPuzzle(state, 'base-09', [singleAt(0)])
  putPuzzle(state, 'base-10', [singleAt(0)])
  mutablePlayer(state).supply.single = 1
  assert.throws(() => finishTouches(state, [
    { puzzleId: 'base-09', placement: singleAt(1) },
    { puzzleId: 'base-10', placement: singleAt(1) },
  ]))
  assert.equal(player(state).supply.single, 1)
})

test('scoring applies full unfinished penalties, permits negative totals, and ranks ties by leftovers', () => {
  const state = finishingFixture()
  mutablePlayer(state).completed = ['base-01']
  putPuzzle(state, 'base-01')
  mutablePlayer(state).supply.single = 1
  mutablePlayer(state).supply.domino = 1
  const next = finishTouches(state, [])
  const scored = finishTouches(next, [])
  assert.equal(scored.phase, 'scored')
  if (scored.phase !== 'scored') throw new Error('Expected scoring')
  const result = scored.results.find((item) => item.playerId === 'a')
  assert.equal(result?.total, 0)
  assert.equal(result?.unfinishedPenalty, 2)

  const negativeTouches = finishingFixture()
  putPuzzle(negativeTouches, 'base-01')
  const n1 = finishTouches(negativeTouches, [])
  const n2 = finishTouches(n1, [])
  if (n2.phase !== 'scored') throw new Error('Expected scoring')
  assert.equal(n2.results.find((item) => item.playerId === 'a')?.total, -2)
  assert.ok(PIECE_IDS.every((id) => n2.players.every((p) => p.supply[id] >= 0)))
})

test('scoring matches the rulebook arithmetic and uses piece-count tie breakers', () => {
  const exampleTouches = finishingFixture()
  mutablePlayer(exampleTouches).completed = ['base-33', 'base-34', 'base-35', 'base-36', 'base-38']
  mutablePlayer(exampleTouches).finishingTouches.piecesPlaced = 3
  const afterA = finishTouches(exampleTouches, [])
  const scoredExample = finishTouches(afterA, [])
  assert.equal(scoredExample.phase, 'scored')
  if (scoredExample.phase !== 'scored') throw new Error('Expected scoring')
  assert.equal(scoredExample.results.find((result) => result.playerId === 'a')?.total, 21)

  const leftoverTieTouches = finishingFixture()
  mutablePlayer(leftoverTieTouches).supply = { ...createInventory(), 'tet-line': 1 }
  mutablePlayer(leftoverTieTouches, 'b').supply = { ...createInventory(), single: 1 }
  const tieAfterA = finishTouches(leftoverTieTouches, [])
  const tied = finishTouches(tieAfterA, [])
  assert.equal(tied.phase, 'scored')
  if (tied.phase !== 'scored') throw new Error('Expected scoring')
  assert.deepEqual(tied.winnerIds, ['a', 'b'])

  const leftoversDifferTouches = finishingFixture()
  mutablePlayer(leftoversDifferTouches).supply = { ...createInventory(), 'tet-line': 1 }
  mutablePlayer(leftoversDifferTouches, 'b').supply = { ...createInventory(), single: 2 }
  const leftoverAfterA = finishTouches(leftoversDifferTouches, [])
  const leftoverResult = finishTouches(leftoverAfterA, [])
  assert.equal(leftoverResult.phase, 'scored')
  if (leftoverResult.phase !== 'scored') throw new Error('Expected scoring')
  assert.deepEqual(leftoverResult.winnerIds, ['b'])
})

test('empty completion reward produces no debt and preserves piece conservation', () => {
  const state = fixture()
  for (const id of PIECE_IDS) mutablePlayer(state).supply[id] += state.reserve[id]
  state.reserve = createInventory()
  putPuzzle(state, 'base-09', [singleAt(0)])
  mutablePlayer(state).supply.single -= 1
  const doneNow = applyAction(state, { type: 'place', puzzleId: 'base-09', placement: singleAt(1) })
  const pending = chooseCompletionOrder(doneNow, ['base-09'])
  assert.equal(turn(pending).completion.status, 'resolve-rewards')
  if (turn(pending).completion.status !== 'resolve-rewards') throw new Error('Expected reward resolution')
  const reward = turn(pending).completion
  if (reward.status !== 'resolve-rewards') throw new Error('Expected reward resolution')
  assert.deepEqual(reward.candidates, [])
  const done = resolveCompletionReward(pending, null)
  assert.deepEqual(player(done).completed, ['base-09'])
  assert.equal(player(done).supply.single, 14)
  assert.ok(isPieceInventoryConserved(done))
})

