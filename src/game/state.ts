import type { Cell } from './geometry.js'
import type { PieceId, PieceInventory } from './pieces.js'
import type { DeckColor, PuzzleId } from './puzzles.js'

export type PlayerId = string
export type PlayerCount = 2 | 3 | 4
export type MarketSlot = 0 | 1 | 2 | 3
export type MarketRow = readonly [PuzzleId | null, PuzzleId | null, PuzzleId | null, PuzzleId | null]

export interface Placement {
  readonly piece: PieceId
  /** Index into PIECES[piece].orientations, relative to the normalized shape. */
  readonly orientation: number
  readonly origin: Cell
}

export interface UnfinishedPuzzle {
  readonly puzzleId: PuzzleId
  readonly placements: readonly Placement[]
}

export interface PlayerState {
  readonly id: PlayerId
  readonly name: string
  readonly supply: PieceInventory
  readonly unfinished: readonly UnfinishedPuzzle[]
  readonly completed: readonly PuzzleId[]
  readonly finishingTouches: {
    readonly piecesPlaced: number
    readonly committed: boolean
  }
}

export interface RandomState {
  readonly algorithm: 'mulberry32'
  readonly seed: number
  /** Current unsigned 32-bit PRNG state, sufficient to resume random draws. */
  readonly state: number
}

export interface GameConfig {
  readonly playerCount: PlayerCount
  readonly visibleScores: boolean
}

/** Latched once the black draw deck empties; rounds are one-based. */
export interface EndgameSchedule {
  readonly triggerRound: number
  readonly finalRound: number
}

/** Fully filled puzzles stay unfinished until the engine resolves this queue. */
export type CompletionState =
  | { readonly status: 'none' }
  | { readonly status: 'choose-order'; readonly puzzleIds: readonly PuzzleId[] }
  | {
    readonly status: 'resolve-rewards'
    /** Chosen full order, retained for replay. */
    readonly order: readonly PuzzleId[]
    readonly nextIndex: number
    readonly puzzleId: PuzzleId
    /** An empty array means the reserve has no available reward. */
    readonly candidates: readonly PieceId[]
  }

export interface TurnState {
  readonly activePlayerId: PlayerId
  readonly round: number
  readonly actionsRemaining: 0 | 1 | 2 | 3
  readonly masterUsed: boolean
  readonly blackTakesAfterTrigger: 0 | 1
  readonly completion: CompletionState
}

export interface ScoreResult {
  readonly playerId: PlayerId
  readonly completedPoints: number
  readonly unfinishedPenalty: number
  readonly finishingTouchesPenalty: number
  readonly total: number
  readonly completedCount: number
  readonly leftoverPieces: number
  /** Equal ranks represent a tie; all rank-1 players share the victory. */
  readonly rank: number
}

interface SharedState {
  readonly schemaVersion: 1
  readonly config: GameConfig
  readonly random: RandomState
  /** Fixed clockwise seating order. */
  readonly players: readonly PlayerState[]
  readonly firstPlayerId: PlayerId
  /** First element is the next draw. Never expose deck order to opponents. */
  readonly decks: Readonly<Record<DeckColor, readonly PuzzleId[]>>
  readonly market: Readonly<Record<DeckColor, MarketRow>>
  readonly excludedBlackPuzzles: readonly PuzzleId[]
  readonly reserve: PieceInventory
  readonly endgame: EndgameSchedule | null
}

/** Authoritative serializable state, not a public player observation. */
export type GameState = SharedState & (
  | { readonly phase: 'turns'; readonly turn: TurnState }
  | { readonly phase: 'finishing-touches'; readonly activePlayerId: PlayerId }
  | { readonly phase: 'scored'; readonly results: readonly ScoreResult[]; readonly winnerIds: readonly PlayerId[] }
)
