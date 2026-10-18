import { COPIES_PER_PIECE, createInventory } from './pieces.js'
import { PUZZLES } from './puzzles.js'
import type { PuzzleId } from './puzzles.js'
import type { GameState, MarketRow, PlayerCount, PlayerState } from './state.js'

export interface SetupOptions {
  /** Ordered clockwise; IDs must be unique and nonempty. */
  readonly players: readonly { readonly id: string; readonly name: string }[]
  readonly seed: number
  readonly visibleScores?: boolean
}

/** Deterministic base-game setup. No UI, clocks, or ambient random source. */
export function createGame(options: SetupOptions): GameState {
  const playerCount = options.players.length
  if (playerCount !== 2 && playerCount !== 3 && playerCount !== 4) {
    throw new Error('The base game requires 2–4 players')
  }
  if (options.players.some((player) => !player.id.trim() || !player.name.trim())
    || new Set(options.players.map((player) => player.id)).size !== playerCount) {
    throw new Error('Players need unique nonempty IDs and nonempty names')
  }
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) {
    throw new Error('Seed must be an unsigned 32-bit integer')
  }
  let randomState = options.seed
  function random(): number {
    randomState = (randomState + 0x6d2b79f5) >>> 0
    let value = randomState
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  function shuffle(ids: readonly PuzzleId[]): PuzzleId[] {
    const shuffled = [...ids]
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }
  const white = shuffle(PUZZLES.filter((puzzle) => puzzle.deck === 'white').map((puzzle) => puzzle.id))
  const allBlack = shuffle(PUZZLES.filter((puzzle) => puzzle.deck === 'black').map((puzzle) => puzzle.id))
  const selectedBlackCount = 8 + 2 * playerCount
  const black = shuffle(allBlack.slice(0, selectedBlackCount))
  const firstPlayerId = options.players[Math.floor(random() * playerCount)].id
  const players: PlayerState[] = options.players.map((player) => ({
    ...player,
    supply: { ...createInventory(), single: 1, domino: 1 },
    unfinished: [],
    completed: [],
    finishingTouches: { piecesPlaced: 0, committed: false },
  }))
  const row = (ids: readonly PuzzleId[]): MarketRow => [ids[0], ids[1], ids[2], ids[3]]
  return {
    schemaVersion: 1,
    config: { playerCount: playerCount as PlayerCount, visibleScores: options.visibleScores ?? false },
    random: { algorithm: 'mulberry32', seed: options.seed, state: randomState },
    players,
    firstPlayerId,
    decks: { white: white.slice(4), black: black.slice(4) },
    market: { white: row(white), black: row(black) },
    excludedBlackPuzzles: allBlack.slice(selectedBlackCount),
    reserve: {
      ...createInventory(COPIES_PER_PIECE),
      single: COPIES_PER_PIECE - playerCount,
      domino: COPIES_PER_PIECE - playerCount,
    },
    endgame: null,
    phase: 'turns',
    turn: {
      activePlayerId: firstPlayerId,
      round: 1,
      actionsRemaining: 3,
      masterUsed: false,
      blackTakesAfterTrigger: 0,
      completion: { status: 'none' },
    },
  }
}
