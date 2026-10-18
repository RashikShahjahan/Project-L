/** Grid coordinates: x increases rightward, y downward. */
export interface Cell {
  readonly x: number
  readonly y: number
}

export type Mask = readonly string[]

export interface Shape {
  readonly cells: readonly Cell[]
  readonly width: number
  readonly height: number
}

/** Read a nonempty rectangular mask, retaining its grid origin. */
export function shapeFromMask(mask: Mask): Shape {
  const width = mask[0]?.length ?? 0
  if (width === 0 || mask.some((row) => row.length !== width || /[^#.]/u.test(row))) {
    throw new Error('A mask must contain rectangular rows of # and .')
  }
  const cells = mask.flatMap((row, y) =>
    [...row].flatMap((square, x) => square === '#' ? [{ x, y }] : []),
  )
  if (cells.length === 0) throw new Error('A mask must have at least one fillable cell')
  return Object.freeze({
    cells: Object.freeze(cells.map((cell) => Object.freeze(cell))),
    width,
    height: mask.length,
  })
}

function normalize(cells: readonly Cell[]): Shape {
  const minX = Math.min(...cells.map((cell) => cell.x))
  const minY = Math.min(...cells.map((cell) => cell.y))
  const normalized = cells.map(({ x, y }) => ({ x: x - minX, y: y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  return Object.freeze({
    cells: Object.freeze(normalized.map((cell) => Object.freeze(cell))),
    width: Math.max(...normalized.map((cell) => cell.x)) + 1,
    height: Math.max(...normalized.map((cell) => cell.y)) + 1,
  })
}

/** Unique rotations, then reflected rotations, each normalized to (0, 0). */
export function orientationsOf(shape: Shape): readonly Shape[] {
  if (shape.cells.length === 0) throw new Error('A shape must contain cells')
  const unique = new Map<string, Shape>()
  for (const reflected of [false, true]) {
    let cells = shape.cells.map(({ x, y }) => ({ x: reflected ? -x : x, y }))
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const orientation = normalize(cells)
      const key = orientation.cells.map(({ x, y }) => `${x},${y}`).join(';')
      if (!unique.has(key)) unique.set(key, orientation)
      cells = cells.map(({ x, y }) => ({ x: -y, y: x }))
    }
  }
  return Object.freeze([...unique.values()])
}
