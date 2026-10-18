import type { PieceId } from './pieces.js'

/** Short piece names shared by the game UI and its help screens. */
export const PIECE_LABELS: Record<PieceId, string> = {
  single: 'Single',
  domino: 'Domino',
  'tri-line': '3-line',
  'tri-corner': '3-corner',
  'tet-t': 'T',
  'tet-line': '4-line',
  'tet-l': 'L',
  'tet-zigzag': 'Zigzag',
  'tet-square': 'Square',
}
