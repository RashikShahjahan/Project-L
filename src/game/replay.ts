import { applyAction, chooseCompletionOrder, finishTouches, resolveCompletionReward } from './engine.js'
import type { GameAction } from './engine.js'
import type { GameState, Placement } from './state.js'
import type { PieceId } from './pieces.js'
import type { PuzzleId } from './puzzles.js'

export type ReplayDecision =
  | { readonly type: 'action'; readonly action: GameAction }
  | { readonly type: 'completion-order'; readonly order: readonly PuzzleId[] }
  | { readonly type: 'completion-reward'; readonly piece: PieceId | null }
  | { readonly type: 'finish-touches'; readonly placements: readonly { readonly puzzleId: PuzzleId; readonly placement: Placement }[] }

export interface ReplayRecord {
  readonly version: 1
  readonly initialState: GameState
  readonly decisions: readonly { readonly decision: ReplayDecision; readonly stateHash: string }[]
  readonly finalState: GameState
}

export function stateHash(state: GameState): string {
  const serialized = JSON.stringify(state)
  let hash = 2166136261
  for (let i = 0; i < serialized.length; i += 1) hash = Math.imul(hash ^ serialized.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function applyDecision(state: GameState, decision: ReplayDecision): GameState {
  switch (decision.type) {
    case 'action': return applyAction(state, decision.action)
    case 'completion-order': return chooseCompletionOrder(state, decision.order)
    case 'completion-reward': return resolveCompletionReward(state, decision.piece)
    case 'finish-touches': return finishTouches(state, decision.placements)
  }
}

export function createReplay(initialState: GameState, entries: readonly ReplayRecord['decisions'][number][], finalState: GameState): ReplayRecord {
  return { version: 1, initialState, decisions: entries, finalState }
}

/** Re-run every recorded decision and fail at the first corrupted or divergent step. */
export function verifyReplay(replay: ReplayRecord): GameState {
  if (replay.version !== 1) throw new Error('Unsupported replay version')
  let state = replay.initialState
  replay.decisions.forEach((entry, index) => {
    state = applyDecision(state, entry.decision)
    const actual = stateHash(state)
    if (actual !== entry.stateHash) throw new Error(`Replay diverged after decision ${index + 1}: expected ${entry.stateHash}, got ${actual}`)
  })
  if (stateHash(state) !== stateHash(replay.finalState)) throw new Error('Replay final state does not match recorded final state')
  return state
}
