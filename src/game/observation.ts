import type { CompletionState, GameState, PlayerId, PlayerState } from './state.js'
import type { PuzzleId } from './puzzles.js'

export type ObservedPlayer = Omit<PlayerState, 'completed'> & { readonly completed?: readonly PuzzleId[] }

/** A player's public table view. Hidden draw order and concealed completed piles are omitted. */
export interface PlayerObservation {
  readonly viewerId: PlayerId
  readonly phase: GameState['phase']
  readonly players: readonly ObservedPlayer[]
  readonly ownSupply: PlayerState['supply']
  readonly market: GameState['market']
  readonly deckCounts: Readonly<Record<'white' | 'black', number>>
  readonly reserve: GameState['reserve']
  readonly endgame: GameState['endgame']
  readonly activePlayerId: PlayerId
  readonly round: number | null
  readonly actionsRemaining: number | null
  readonly completion: CompletionState | null
}

export function observe(state: GameState, viewerId: PlayerId): PlayerObservation {
  const own = state.players.find((player) => player.id === viewerId)
  if (!own) throw new Error(`Unknown player ${viewerId}`)
  const publicPlayers: ObservedPlayer[] = state.players.map((player) => {
    const showCompleted = state.phase === 'scored' || player.id === viewerId || state.config.visibleScores
    const { completed, ...visiblePlayer } = player
    return showCompleted ? { ...visiblePlayer, completed } : visiblePlayer
  })
  const turn = state.phase === 'turns' ? state.turn : null
  return structuredClone({
    viewerId, phase: state.phase, players: publicPlayers, ownSupply: own.supply,
    market: state.market, deckCounts: { white: state.decks.white.length, black: state.decks.black.length },
    reserve: state.reserve, endgame: state.endgame,
    activePlayerId: turn?.activePlayerId ?? (state.phase === 'finishing-touches' ? state.activePlayerId : viewerId),
    round: turn?.round ?? null, actionsRemaining: turn?.actionsRemaining ?? null,
    completion: turn?.completion ?? null,
  })
}
