import { getPuzzle } from './puzzles.js'
import type { DeckColor, PuzzleId } from './puzzles.js'
import { PIECES, PIECE_IDS, createInventory } from './pieces.js'
import type { PieceId, PieceInventory, PieceLevel } from './pieces.js'
import type { Cell, Shape } from './geometry.js'
import type { CompletionState, GameState, MarketRow, PlayerState, Placement, ScoreResult, TurnState, UnfinishedPuzzle } from './state.js'

type TurnGameState = Extract<GameState, { readonly phase: 'turns' }>

export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}

export type GameAction =
  | { readonly type: 'take'; readonly source: 'market'; readonly deck: DeckColor; readonly slot: 0 | 1 | 2 | 3 }
  | { readonly type: 'take'; readonly source: 'deck'; readonly deck: DeckColor }
  | { readonly type: 'recycle'; readonly deck: DeckColor; readonly bottomOrder: readonly PuzzleId[] }
  | { readonly type: 'upgrade'; readonly kind: 'new'; readonly piece: PieceId }
  | { readonly type: 'upgrade'; readonly kind: 'exchange'; readonly returnPiece: PieceId; readonly requestedPiece: PieceId; readonly piece: PieceId }
  | { readonly type: 'place'; readonly puzzleId: PuzzleId; readonly placement: Placement }
  | { readonly type: 'master'; readonly placements: readonly { readonly puzzleId: PuzzleId; readonly placement: Placement }[] }

function fail(message: string): never { throw new RuleError(message) }
function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length
    && a.every((item) => b.includes(item))
}
function copyInventory(inventory: PieceInventory): Record<PieceId, number> { return { ...inventory } }
function sumInventory(inventory: PieceInventory): number { return PIECE_IDS.reduce((sum, id) => sum + inventory[id], 0) }

/** Available reserve fallback choices for a requested piece type, in catalog order. */
export function acquisitionCandidates(reserve: PieceInventory, requested: PieceId): readonly PieceId[] {
  if (reserve[requested] > 0) return [requested]
  const level = PIECES[requested].level
  const sameLevel = PIECE_IDS.filter((id) => PIECES[id].level === level && reserve[id] > 0)
  if (sameLevel.length) return sameLevel
  const lower = PIECE_IDS.filter((id) => PIECES[id].level < level && reserve[id] > 0)
  const nextHigherLevel = ([1, 2, 3, 4] as const).find((candidate) => candidate > level
    && PIECE_IDS.some((id) => PIECES[id].level === candidate && reserve[id] > 0))
  const higher = nextHigherLevel === undefined ? [] : PIECE_IDS.filter((id) => PIECES[id].level === nextHigherLevel && reserve[id] > 0)
  return [...lower, ...higher]
}

function replacePlayer(state: GameState, player: PlayerState): PlayerState[] {
  return state.players.map((candidate) => candidate.id === player.id ? player : candidate)
}
function activePlayer(state: GameState): PlayerState {
  if (state.phase !== 'turns') fail('There is no active action phase')
  const player = state.players.find((candidate) => candidate.id === state.turn.activePlayerId)
  if (!player) fail('Active player is missing')
  return player
}
function requireAction(state: GameState): { player: PlayerState; turn: TurnState } {
  if (state.phase !== 'turns') fail('Actions are only allowed during normal turns')
  if (state.turn.completion.status !== 'none') fail('Resolve puzzle completions before taking another action')
  if (state.turn.actionsRemaining === 0) fail('No actions remain this turn')
  return { player: activePlayer(state), turn: state.turn }
}
function changeSupply(supply: PieceInventory, piece: PieceId, delta: number): Record<PieceId, number> {
  const next = copyInventory(supply)
  next[piece] += delta
  if (next[piece] < 0 || next[piece] > 15) fail(`Invalid ${piece} supply count`)
  return next
}
function spend(turn: TurnState, changes: Partial<Pick<TurnState, 'masterUsed' | 'blackTakesAfterTrigger'>> = {}): TurnState {
  return { ...turn, ...changes, actionsRemaining: (turn.actionsRemaining - 1) as TurnState['actionsRemaining'] }
}
function cellKey(cell: Cell): string { return `${cell.x},${cell.y}` }
function placementCells(placement: Placement): readonly Cell[] {
  const orientations = PIECES[placement.piece].orientations
  const orientation = orientations[placement.orientation]
  if (!orientation || !Number.isInteger(placement.origin.x) || !Number.isInteger(placement.origin.y)) fail('Invalid piece orientation or origin')
  return orientation.cells.map(({ x, y }) => ({ x: x + placement.origin.x, y: y + placement.origin.y }))
}
function validatePlacement(unfinished: UnfinishedPuzzle, placement: Placement): void {
  const puzzle = getPuzzle(unfinished.puzzleId)
  const region = new Set(puzzle.shape.cells.map(cellKey))
  const occupied = new Set(unfinished.placements.flatMap((placed) => placementCells(placed)).map(cellKey))
  const cells = placementCells(placement)
  if (cells.some((cell) => !region.has(cellKey(cell)))) fail('Piece must fit entirely within the puzzle without overlap')
  if (cells.some((cell) => occupied.has(cellKey(cell)))) fail('Piece overlaps a placed piece')
}
function isComplete(unfinished: UnfinishedPuzzle): boolean {
  const puzzle = getPuzzle(unfinished.puzzleId)
  const filled = new Set(unfinished.placements.flatMap((placed) => placementCells(placed)).map(cellKey))
  return puzzle.shape.cells.every((cell) => filled.has(cellKey(cell)))
}
function addPlacement(player: PlayerState, puzzleId: PuzzleId, placement: Placement): PlayerState {
  if (player.supply[placement.piece] < 1) fail(`No ${placement.piece} piece in personal supply`)
  const index = player.unfinished.findIndex((puzzle) => puzzle.puzzleId === puzzleId)
  if (index < 0) fail('The selected puzzle is not unfinished by this player')
  const target = player.unfinished[index]
  validatePlacement(target, placement)
  const unfinished = [...player.unfinished]
  unfinished[index] = { ...target, placements: [...target.placements, placement] }
  return { ...player, supply: changeSupply(player.supply, placement.piece, -1), unfinished }
}

function beginCompletion(state: TurnGameState, player: PlayerState, turn: TurnState): GameState {
  const completedNow = player.unfinished.filter(isComplete).map((puzzle) => puzzle.puzzleId)
  const completion: CompletionState = completedNow.length
    ? { status: 'choose-order', puzzleIds: completedNow }
    : { status: 'none' }
  const nextTurn = { ...turn, completion }
  const next: GameState = { ...state, players: replacePlayer(state, player), turn: nextTurn }
  return completion.status === 'none' && nextTurn.actionsRemaining === 0 ? advanceTurn(next) : next
}

function triggerEndgame(state: GameState, turn: TurnState, deck: DeckColor, deckEmpty: boolean): { endgame: GameState['endgame']; turn: TurnState } {
  if (deck !== 'black' || !deckEmpty || state.endgame !== null) return { endgame: state.endgame, turn }
  return {
    endgame: { triggerRound: turn.round, finalRound: turn.round + 1 },
    turn: { ...turn, blackTakesAfterTrigger: 0 },
  }
}

/** Apply one legal base-game action as a pure immutable state transition. */
export function applyAction(state: GameState, action: GameAction): GameState {
  if (state.phase !== 'turns') fail('Actions are only allowed during normal turns')
  const { player: originalPlayer, turn: originalTurn } = requireAction(state)
  let player = originalPlayer
  let turn = originalTurn
  let decks = state.decks
  let market = state.market
  let reserve = state.reserve
  let endgame = state.endgame

  switch (action.type) {
    case 'take': {
      if (player.unfinished.length >= 4) fail('A player cannot have more than four unfinished puzzles')
      if (action.deck === 'black' && endgame && turn.blackTakesAfterTrigger >= 1) fail('Only one black puzzle may be taken per turn after the endgame trigger')
      let puzzleId: PuzzleId | undefined
      let rows = { ...market }
      let newDecks = { ...decks }
      if (action.source === 'deck') {
        puzzleId = decks[action.deck][0]
        if (!puzzleId) fail(`The ${action.deck} deck is empty`)
        newDecks[action.deck] = decks[action.deck].slice(1)
      } else {
        puzzleId = market[action.deck][action.slot] ?? undefined
        if (!puzzleId) fail('The selected market slot is empty')
        const slots = [...market[action.deck]] as (PuzzleId | null)[]
        if (action.deck === 'black' && endgame) {
          slots[action.slot] = null
        } else {
          const replacement = decks[action.deck][0] ?? null
          slots[action.slot] = replacement
          newDecks[action.deck] = replacement === null ? decks[action.deck] : decks[action.deck].slice(1)
        }
        rows = { ...market, [action.deck]: [slots[0], slots[1], slots[2], slots[3]] }
      }
      if (!puzzleId || getPuzzle(puzzleId).deck !== action.deck) fail('Puzzle deck does not match the selected row')
      player = { ...player, unfinished: [...player.unfinished, { puzzleId, placements: [] }] }
      decks = newDecks
      market = rows
      const wasTriggered = endgame !== null
      const triggered = triggerEndgame(state, turn, action.deck, decks[action.deck].length === 0)
      endgame = triggered.endgame
      turn = triggered.turn
      if (action.deck === 'black' && wasTriggered) turn = { ...turn, blackTakesAfterTrigger: 1 }
      break
    }
    case 'recycle': {
      const currentRow = market[action.deck].filter((id): id is PuzzleId => id !== null)
      if (!sameSet(action.bottomOrder, currentRow)) fail('Recycle order must contain every puzzle in the selected row exactly once')
      const combined = [...decks[action.deck], ...action.bottomOrder]
      const reveal = combined.slice(0, 4)
      const remaining = combined.slice(4)
      const slots: MarketRow = [reveal[0] ?? null, reveal[1] ?? null, reveal[2] ?? null, reveal[3] ?? null]
      decks = { ...decks, [action.deck]: remaining }
      market = { ...market, [action.deck]: slots }
      break
    }
    case 'upgrade': {
      const newReserve = copyInventory(reserve)
      let requested: PieceId
      if (action.kind === 'new') {
        requested = 'single'
      } else {
        const heldLevel = PIECES[action.returnPiece].level
        const requestedLevel = PIECES[action.requestedPiece].level
        if (requestedLevel > heldLevel + 1) fail('Exchange can request only the same, lower, or one higher level')
        if (player.supply[action.returnPiece] < 1) fail(`No ${action.returnPiece} piece to exchange`)
        player = { ...player, supply: changeSupply(player.supply, action.returnPiece, -1) }
        newReserve[action.returnPiece] += 1
        requested = action.requestedPiece
      }
      const candidates = acquisitionCandidates(newReserve, requested)
      if (!candidates.includes(action.piece)) fail('Selected replacement is not available under reserve shortage rules')
      player = { ...player, supply: changeSupply(player.supply, action.piece, 1) }
      newReserve[action.piece] -= 1
      reserve = newReserve
      break
    }
    case 'place': {
      player = addPlacement(player, action.puzzleId, action.placement)
      break
    }
    case 'master': {
      if (turn.masterUsed) fail('Master may be used only once per turn')
      if (action.placements.length > 4) fail('Master allows at most one placement in each unfinished puzzle')
      const targets = action.placements.map(({ puzzleId }) => puzzleId)
      if (new Set(targets).size !== targets.length) fail('Master may target each puzzle at most once')
      const usage = { ...createInventory() }
      for (const item of action.placements) usage[item.placement.piece] += 1
      if (PIECE_IDS.some((id) => usage[id] > player.supply[id])) fail('Master placements require more pieces than are in supply')
      for (const item of action.placements) {
        player = addPlacement(player, item.puzzleId, item.placement)
      }
      turn = spend(turn, { masterUsed: true })
      return beginCompletion(state, player, turn)
    }
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
  turn = spend(turn)
  const next: GameState = { ...state, players: replacePlayer(state, player), turn, decks, market, reserve, endgame }
  return beginCompletion(next, player, turn)
}

/** Commit the active player's chosen order for simultaneous puzzle completions. */
export function chooseCompletionOrder(state: GameState, order: readonly PuzzleId[]): GameState {
  if (state.phase !== 'turns' || state.turn.completion.status !== 'choose-order') fail('No completion order is pending')
  if (!sameSet(order, state.turn.completion.puzzleIds)) fail('Completion order must list each newly completed puzzle exactly once')
  return prepareReward(state, order, 0)
}

function prepareReward(state: TurnGameState, order: readonly PuzzleId[], nextIndex: number): GameState {
  if (nextIndex >= order.length) {
    const turn: TurnState = { ...state.turn, completion: { status: 'none' } }
    const finished: GameState = { ...state, turn }
    return turn.actionsRemaining === 0 ? advanceTurn(finished) : finished
  }
  const puzzleId = order[nextIndex]
  const reward = getPuzzle(puzzleId).reward
  const completion: CompletionState = {
    status: 'resolve-rewards', order, nextIndex, puzzleId,
    candidates: acquisitionCandidates(state.reserve, reward),
  }
  return { ...state, turn: { ...state.turn, completion } }
}

/** Resolve the current completion. Pass null when the reserve has no pieces. */
export function resolveCompletionReward(state: GameState, selected: PieceId | null): GameState {
  if (state.phase !== 'turns' || state.turn.completion.status !== 'resolve-rewards') fail('No completion reward is pending')
  const pending = state.turn.completion
  if (pending.candidates.length === 0 ? selected !== null : selected === null || !pending.candidates.includes(selected)) {
    fail('Selected reward is not an available reserve fallback')
  }
  const player = activePlayer(state)
  const index = player.unfinished.findIndex((puzzle) => puzzle.puzzleId === pending.puzzleId)
  if (index < 0 || !isComplete(player.unfinished[index])) fail('Pending puzzle is no longer complete')
  const completedPuzzle = player.unfinished[index]
  let supply = copyInventory(player.supply)
  for (const placement of completedPuzzle.placements) supply[placement.piece] += 1
  let reserve = state.reserve
  if (selected !== null) {
    const nextReserve = copyInventory(state.reserve)
    nextReserve[selected] -= 1
    reserve = nextReserve
    supply[selected] += 1
  }
  const unfinished = player.unfinished.filter((_, i) => i !== index)
  const updatedPlayer: PlayerState = { ...player, supply, unfinished, completed: [...player.completed, pending.puzzleId] }
  const base: TurnGameState = { ...state, players: replacePlayer(state, updatedPlayer), reserve }
  return prepareReward(base, pending.order, pending.nextIndex + 1)
}

function advanceTurn(state: GameState): GameState {
  if (state.phase !== 'turns' || state.turn.completion.status !== 'none') return state
  const { players, turn, endgame } = state
  const index = players.findIndex((player) => player.id === turn.activePlayerId)
  const nextIndex = (index + 1) % players.length
  const nextPlayer = players[nextIndex]
  const roundComplete = nextPlayer.id === state.firstPlayerId
  if (roundComplete && endgame !== null && turn.round >= endgame.finalRound) {
    return { ...state, phase: 'finishing-touches', activePlayerId: state.firstPlayerId }
  }
  const nextRound = roundComplete ? turn.round + 1 : turn.round
  return {
    ...state,
    turn: {
      activePlayerId: nextPlayer.id,
      round: nextRound,
      actionsRemaining: 3,
      masterUsed: false,
      blackTakesAfterTrigger: 0,
      completion: { status: 'none' },
    },
  }
}

/** Place an optional Finishing Touches batch, then commit that player. */
export function finishTouches(state: GameState, placements: readonly { readonly puzzleId: PuzzleId; readonly placement: Placement }[]): GameState {
  if (state.phase !== 'finishing-touches') fail('Finishing Touches are not active')
  let player = state.players.find((candidate) => candidate.id === state.activePlayerId)
  if (!player || player.finishingTouches.committed) fail('This player has already committed Finishing Touches')
  for (const item of placements) player = addPlacement(player, item.puzzleId, item.placement)
  const completedIds = player.unfinished.filter(isComplete).map((puzzle) => puzzle.puzzleId)
  if (completedIds.length) {
    const completedSet = new Set(completedIds)
    let supply = copyInventory(player.supply)
    for (const puzzle of player.unfinished) {
      if (completedSet.has(puzzle.puzzleId)) for (const placement of puzzle.placements) supply[placement.piece] += 1
    }
    player = {
      ...player,
      supply,
      unfinished: player.unfinished.filter((puzzle) => !completedSet.has(puzzle.puzzleId)),
      completed: [...player.completed, ...completedIds],
    }
  }
  player = {
    ...player,
    finishingTouches: { piecesPlaced: player.finishingTouches.piecesPlaced + placements.length, committed: true },
  }
  const players = replacePlayer(state, player)
  const currentIndex = players.findIndex((candidate) => candidate.id === player.id)
  const nextPlayer = players.slice(currentIndex + 1).concat(players.slice(0, currentIndex)).find((candidate) => !candidate.finishingTouches.committed)
  if (nextPlayer) return { ...state, players, activePlayerId: nextPlayer.id }
  return scoreGame({ ...state, players })
}

function scoreGame(state: GameState): GameState {
  const provisional = state.players.map((player) => {
    const completedPoints = player.completed.reduce((sum, id) => sum + getPuzzle(id).points, 0)
    const unfinishedPenalty = player.unfinished.reduce((sum, item) => sum + getPuzzle(item.puzzleId).points, 0)
    const finishingTouchesPenalty = player.finishingTouches.piecesPlaced
    return {
      playerId: player.id,
      completedPoints,
      unfinishedPenalty,
      finishingTouchesPenalty,
      total: completedPoints - unfinishedPenalty - finishingTouchesPenalty,
      completedCount: player.completed.length,
      leftoverPieces: sumInventory(player.supply),
      rank: 0,
    }
  })
  const compare = (a: ScoreResult, b: ScoreResult): number => b.total - a.total
    || b.completedCount - a.completedCount || b.leftoverPieces - a.leftoverPieces
  const results: ScoreResult[] = provisional.map((result) => ({
    ...result,
    rank: 1 + provisional.filter((other) => compare(other, result) < 0).length,
  }))
  return { ...state, phase: 'scored', results, winnerIds: results.filter((result) => result.rank === 1).map((result) => result.playerId) }
}

/** Enumerate legal placements for a piece in a puzzle's current remaining cells. */
export function legalPlacements(player: Pick<PlayerState, 'supply' | 'unfinished'>, puzzleId: PuzzleId, piece: PieceId): readonly Placement[] {
  if (player.supply[piece] < 1) return []
  const unfinished = player.unfinished.find((puzzle) => puzzle.puzzleId === puzzleId)
  if (!unfinished) return []
  const puzzleShape: Shape = getPuzzle(puzzleId).shape
  const region = new Set(puzzleShape.cells.map(cellKey))
  const occupied = new Set(unfinished.placements.flatMap((placed) => placementCells(placed)).map(cellKey))
  const result: Placement[] = []
  for (let orientation = 0; orientation < PIECES[piece].orientations.length; orientation += 1) {
    const shape = PIECES[piece].orientations[orientation]
    for (let y = 0; y <= puzzleShape.height - shape.height; y += 1) {
      for (let x = 0; x <= puzzleShape.width - shape.width; x += 1) {
        const placement: Placement = { piece, orientation, origin: { x, y } }
        const cells = placementCells(placement)
        if (cells.every((cell) => region.has(cellKey(cell)) && !occupied.has(cellKey(cell)))) result.push(placement)
      }
    }
  }
  return result
}

/** Count all physical pieces currently represented in the active game. */
export function pieceConservation(state: GameState): PieceInventory {
  const counts = copyInventory(state.reserve)
  for (const player of state.players) {
    for (const id of PIECE_IDS) counts[id] += player.supply[id]
    for (const puzzle of player.unfinished) for (const placement of puzzle.placements) counts[placement.piece] += 1
  }
  return counts
}

export function isPieceInventoryConserved(state: GameState): boolean {
  const counts = pieceConservation(state)
  return PIECE_IDS.every((id) => counts[id] === 15)
}

export function levelOf(piece: PieceId): PieceLevel { return PIECES[piece].level }
