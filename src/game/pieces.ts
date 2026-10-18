import { orientationsOf, shapeFromMask } from './geometry.js'
import type { Mask, Shape } from './geometry.js'

export const PIECE_IDS = [
  'single', 'domino', 'tri-line', 'tri-corner', 'tet-t',
  'tet-line', 'tet-l', 'tet-zigzag', 'tet-square',
] as const

export type PieceId = typeof PIECE_IDS[number]
export type PieceLevel = 1 | 2 | 3 | 4
/** Counts represent physical copies, not occupied area. */
export type PieceInventory = Readonly<Record<PieceId, number>>

export interface PieceDefinition {
  readonly id: PieceId
  readonly level: PieceLevel
  readonly mask: Mask
  readonly shape: Shape
  /** Stable index used by placements; symmetric duplicates are omitted. */
  readonly orientations: readonly Shape[]
}

function definePiece(id: PieceId, level: PieceLevel, rows: string[]): PieceDefinition {
  const mask = Object.freeze(rows)
  const shape = shapeFromMask(mask)
  if (shape.cells.length !== level) throw new Error(`Invalid piece area: ${id}`)
  return Object.freeze({ id, level, mask, shape, orientations: orientationsOf(shape) })
}

export const PIECES: Readonly<Record<PieceId, PieceDefinition>> = Object.freeze({
  single: definePiece('single', 1, ['#']),
  domino: definePiece('domino', 2, ['##']),
  'tri-line': definePiece('tri-line', 3, ['###']),
  'tri-corner': definePiece('tri-corner', 3, ['#.', '##']),
  'tet-t': definePiece('tet-t', 4, ['###', '.#.']),
  'tet-line': definePiece('tet-line', 4, ['####']),
  'tet-l': definePiece('tet-l', 4, ['#.', '#.', '##']),
  'tet-zigzag': definePiece('tet-zigzag', 4, ['.##', '##.']),
  'tet-square': definePiece('tet-square', 4, ['##', '##']),
})

export const COPIES_PER_PIECE = 15

/** Fresh, complete inventory; callers update counts by producing a new object. */
export function createInventory(count = 0): PieceInventory {
  if (!Number.isSafeInteger(count) || count < 0 || count > COPIES_PER_PIECE) {
    throw new Error('Inventory counts must be integers from 0 to 15')
  }
  return Object.fromEntries(PIECE_IDS.map((id) => [id, count])) as Record<PieceId, number>
}

export function isPieceId(value: unknown): value is PieceId {
  return typeof value === 'string' && PIECE_IDS.some((id) => id === value)
}
