import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COPIES_PER_PIECE, PIECE_IDS, PIECES, PUZZLES, createGame,
  createInventory, getPuzzle, shapeFromMask,
} from '../src/game/index.js'

const players = [
  { id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Charlie' }, { id: 'd', name: 'Dara' },
]

test('all nine shapes have the specified area and distinct legal orientations', () => {
  const expectedCounts = [1, 2, 2, 4, 4, 2, 8, 4, 1]
  for (const [index, id] of PIECE_IDS.entries()) {
    const piece = PIECES[id]
    assert.equal(piece.shape.cells.length, piece.level)
    assert.equal(piece.orientations.length, expectedCounts[index], id)
    const keys = piece.orientations.map((shape) => {
      assert.equal(shape.cells.length, piece.level)
      assert.equal(Math.min(...shape.cells.map((cell) => cell.x)), 0)
      assert.equal(Math.min(...shape.cells.map((cell) => cell.y)), 0)
      assert.equal(Math.max(...shape.cells.map((cell) => cell.x)) + 1, shape.width)
      assert.equal(Math.max(...shape.cells.map((cell) => cell.y)) + 1, shape.height)
      return shape.cells.map(({ x, y }) => `${x},${y}`).join(';')
    })
    assert.equal(new Set(keys).size, expectedCounts[index])
  }
  // L reflections must remain available, beyond its four rotations.
  assert.ok(PIECES['tet-l'].orientations.some((shape) =>
    JSON.stringify(shape.cells) === JSON.stringify([
      { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 },
    ]),
  ))
})

test('mask coordinates preserve recess holes and reject malformed masks', () => {
  assert.deepEqual(shapeFromMask(['.#.', '###']).cells, [
    { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
  ])
  for (const mask of [[], [''], ['...'], ['##', '#'], ['#x']]) {
    assert.throws(() => shapeFromMask(mask))
  }
})

test('catalog preserves physical duplicate cards and printed metadata', () => {
  assert.equal(PUZZLES.length, 52)
  assert.equal(PUZZLES.filter((puzzle) => puzzle.deck === 'white').length, 32)
  assert.equal(PUZZLES.filter((puzzle) => puzzle.deck === 'black').length, 20)
  assert.equal(new Set(PUZZLES.map((puzzle) => puzzle.id)).size, 52)
  const first = getPuzzle('base-01')
  assert.equal(first.points, 2)
  assert.equal(first.reward, 'domino')
  assert.equal(first.shape.cells.length, 5)
  const duplicateA = getPuzzle('base-22')
  const duplicateB = getPuzzle('base-23')
  assert.notEqual(duplicateA.id, duplicateB.id)
  assert.deepEqual(duplicateA.mask, duplicateB.mask)
  assert.equal(duplicateA.points, 0)
  assert.equal(duplicateB.points, 0)
  assert.equal(duplicateA.reward, 'domino')
  assert.equal(duplicateB.reward, 'domino')
  assert.throws(() => getPuzzle('base-99'))
})

for (const count of [2, 3, 4]) {
  test(`${count}-player setup partitions all cards and conserves all 135 pieces`, () => {
    // Check many shuffles, including seed zero and the uint32 maximum.
    for (const seed of [0, 1, 42, 12345, 0xffffffff]) {
      const game = createGame({ players: players.slice(0, count), seed })
      assert.equal(game.config.playerCount, count)
      assert.equal(game.config.visibleScores, false)
      assert.deepEqual(game.players.map((player) => player.id), players.slice(0, count).map((player) => player.id))
      assert.equal(game.market.white.length, 4)
      assert.equal(game.market.black.length, 4)
      assert.equal(game.decks.white.length, 28)
      assert.equal(game.decks.black.length, 4 + 2 * count)
      assert.equal(game.excludedBlackPuzzles.length, 12 - 2 * count)
      const ids = [...game.decks.white, ...game.decks.black,
        ...game.market.white, ...game.market.black, ...game.excludedBlackPuzzles]
      assert.equal(ids.length, 52)
      assert.equal(new Set(ids).size, 52)
      assert.ok(ids.every((id) => id !== null))
      for (const color of ['white', 'black'] as const) {
        for (const id of [...game.decks[color], ...game.market[color]]) {
          assert.ok(id)
          assert.equal(getPuzzle(id).deck, color)
        }
      }
      for (const id of game.excludedBlackPuzzles) assert.equal(getPuzzle(id).deck, 'black')
      for (const player of game.players) {
        assert.deepEqual(player.supply, { ...createInventory(), single: 1, domino: 1 })
        assert.deepEqual(player.unfinished, [])
        assert.deepEqual(player.completed, [])
        assert.deepEqual(player.finishingTouches, { piecesPlaced: 0, committed: false })
      }
      for (const id of PIECE_IDS) {
        assert.equal(game.reserve[id] + game.players.reduce((sum, player) => sum + player.supply[id], 0), COPIES_PER_PIECE)
      }
      assert.equal(game.endgame, null)
      assert.equal(game.phase, 'turns')
      if (game.phase !== 'turns') throw new Error('Expected turn phase')
      assert.ok(game.players.some((player) => player.id === game.firstPlayerId))
      assert.deepEqual(game.turn, {
        activePlayerId: game.firstPlayerId, round: 1, actionsRemaining: 3,
        masterUsed: false, blackTakesAfterTrigger: 0, completion: { status: 'none' },
      })
    }
  })
}

test('setup is reproducible, serializable, and independent across games', () => {
  const options = { players: players.slice(0, 2), seed: 42, visibleScores: true }
  const game = createGame(options)
  const again = createGame(options)
  assert.deepEqual(game, again)
  assert.deepEqual(JSON.parse(JSON.stringify(game)), game)
  assert.notEqual(game.reserve, again.reserve)
  assert.notEqual(game.players[0].supply, game.players[1].supply)
  assert.notEqual(game.players[0].unfinished, again.players[0].unfinished)
  assert.notEqual(game.players[0], options.players[0])
  assert.equal(game.config.visibleScores, true)
  assert.equal(game.random.algorithm, 'mulberry32')
  assert.equal(game.random.seed, 42)
  assert.notDeepEqual(game, createGame({ ...options, seed: 43 }))
  assert.deepEqual(options.players, players.slice(0, 2))
})

test('setup rejects unsupported counts, duplicate IDs, empty names, and invalid seeds', () => {
  for (const list of [[], players.slice(0, 1), [...players, { id: 'e', name: 'Eve' }],
    [players[0], players[0]], [players[0], { id: ' ', name: 'Bob' }],
    [players[0], { id: 'b', name: '' }]]) {
    assert.throws(() => createGame({ players: list, seed: 1 }))
  }
  for (const seed of [-1, 0x100000000, 1.5, NaN, Infinity]) {
    assert.throws(() => createGame({ players: players.slice(0, 2), seed }))
  }
  for (const count of [-1, 1.5, 16, NaN]) assert.throws(() => createInventory(count))
})
