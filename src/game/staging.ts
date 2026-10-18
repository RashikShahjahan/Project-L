import { legalPlacements, RuleError } from './engine.js'
import type { PuzzleId } from './puzzles.js'
import type { Placement, PlayerState } from './state.js'

export type StagedPlacement = { readonly puzzleId: PuzzleId; readonly placement: Placement }
type StagingPlayer = Pick<PlayerState, 'supply' | 'unfinished'>

export function previewPlayer<T extends StagingPlayer>(player: T, batch: readonly StagedPlacement[]): T {
  const supply = { ...player.supply }
  const unfinished = player.unfinished.map((puzzle) => ({ ...puzzle, placements: [...puzzle.placements] }))
  for (const { puzzleId, placement } of batch) {
    supply[placement.piece] -= 1
    unfinished.find((puzzle) => puzzle.puzzleId === puzzleId)?.placements.push(placement)
  }
  return { ...player, supply, unfinished }
}

export function stagePlacement(player: StagingPlayer, batch: readonly StagedPlacement[], item: StagedPlacement, master: boolean): StagedPlacement[] {
  if (master && batch.some((staged) => staged.puzzleId === item.puzzleId)) {
    throw new RuleError('Master allows one placement per puzzle.')
  }
  const preview = previewPlayer(player, batch)
  const { placement } = item
  const legal = legalPlacements(preview, item.puzzleId, placement.piece).some((candidate) =>
    candidate.orientation === placement.orientation
    && candidate.origin.x === placement.origin.x && candidate.origin.y === placement.origin.y)
  if (!legal) throw new RuleError('That placement is not legal.')
  return [...batch, item]
}
