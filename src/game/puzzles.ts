import catalog from '../../data/base-game-puzzles.json' with { type: 'json' }
import { shapeFromMask } from './geometry.js'
import type { Mask, Shape } from './geometry.js'
import { isPieceId } from './pieces.js'
import type { PieceId } from './pieces.js'

export type PuzzleId = `base-${string}`
export type DeckColor = 'white' | 'black'

/** Static definition of a physical card. Identical designs retain separate IDs. */
export interface PuzzleDefinition {
  readonly id: PuzzleId
  readonly sourceNumber: number
  readonly deck: DeckColor
  readonly points: number
  readonly reward: PieceId
  readonly mask: Mask
  readonly shape: Shape
}

export const PUZZLES: readonly PuzzleDefinition[] = Object.freeze(catalog.puzzles.map((entry) => {
  if (!/^base-\d{2}$/u.test(entry.id)
    || (entry.deck !== 'white' && entry.deck !== 'black')
    || !isPieceId(entry.reward)
    || !Number.isSafeInteger(entry.points) || entry.points < 0) {
    throw new Error(`Invalid puzzle definition: ${entry.id}`)
  }
  const mask = Object.freeze([...entry.mask])
  return Object.freeze({
    id: entry.id as PuzzleId,
    sourceNumber: entry.sourceNumber,
    deck: entry.deck,
    points: entry.points,
    reward: entry.reward,
    mask,
    shape: shapeFromMask(mask),
  })
}))

const puzzleById = new Map(PUZZLES.map((puzzle) => [puzzle.id, puzzle]))
if (puzzleById.size !== 52 || PUZZLES.filter((puzzle) => puzzle.deck === 'white').length !== 32) {
  throw new Error('The base-game catalog must contain 32 white and 20 black physical puzzles')
}

export function getPuzzle(id: PuzzleId): PuzzleDefinition {
  const puzzle = puzzleById.get(id)
  if (!puzzle) throw new Error(`Unknown puzzle: ${id}`)
  return puzzle
}
