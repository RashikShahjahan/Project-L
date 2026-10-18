import { chooseCompletionOrder, resolveCompletionReward } from './engine.js'
import type { ReplayDecision } from './replay.js'
import type { CompletionState, GameState } from './state.js'

/** Only remove prompts that offer no choice; keep every engine/replay decision explicit. */
export function automaticCompletionDecision(completion: CompletionState | null): ReplayDecision | null {
  if (completion?.status === 'choose-order' && completion.puzzleIds.length === 1) return { type: 'completion-order', order: completion.puzzleIds }
  if (completion?.status === 'resolve-rewards' && completion.candidates.length <= 1) return { type: 'completion-reward', piece: completion.candidates[0] ?? null }
  return null
}

export function resolveAutomaticCompletions(state: GameState): GameState {
  let next = state
  while (next.phase === 'turns') {
    const decision = automaticCompletionDecision(next.turn.completion)
    if (decision?.type === 'completion-order') next = chooseCompletionOrder(next, decision.order)
    else if (decision?.type === 'completion-reward') next = resolveCompletionReward(next, decision.piece)
    else break
  }
  return next
}
