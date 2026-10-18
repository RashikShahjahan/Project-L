import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { acquisitionCandidates, legalPlacements } from '../game/engine.js'
import type { GameAction } from '../game/engine.js'
import { PIECES, PIECE_IDS } from '../game/pieces.js'
import type { PieceId, PieceInventory } from '../game/pieces.js'
import { PIECE_LABELS } from '../game/piece-labels.js'
import type { DeckColor, PuzzleId } from '../game/puzzles.js'
import type { MarketRow, UnfinishedPuzzle } from '../game/state.js'
import type { StagedPlacement } from '../game/staging.js'

export interface TableTools {
  canStart: boolean
  canTakePiece: boolean
  onTakePiece: () => void
  onExchange: (piece: PieceId) => void
  onRecycle: (deck: DeckColor) => void
  onMaster: () => void
  hasPlacement: boolean
  masterUsed: boolean
}

export interface ReserveInteraction {
  choices: readonly PieceId[]
  label: string
  source: PieceId | null
  counts: PieceInventory
  onChoose: (piece: PieceId) => void
  onBack?: () => void
  onCancel: () => void
}
export interface RecycleInteraction {
  deck: DeckColor | null
  order: readonly PuzzleId[]
  onDeck: (deck: DeckColor) => void
  onMove: (from: number, to: number) => void
  onConfirm: () => void
  onCancel: () => void
}

interface Options {
  resetKey: string | number
  enabled: boolean
  masterUsed: boolean
  player: { supply: PieceInventory; unfinished: readonly UnfinishedPuzzle[] } | undefined
  reserve: PieceInventory
  market: Readonly<Record<DeckColor, MarketRow>>
  batch: readonly StagedPlacement[]
  onBatch: Dispatch<SetStateAction<StagedPlacement[]>>
  onAction: (action: GameAction) => void
}

export function useTableActions({ resetKey, enabled, masterUsed, player, reserve, market, batch, onBatch, onAction }: Options) {
  type Selection = { key: string | number; mode: 'upgrade' | 'recycle' | 'master' | null; source: PieceId | null; requested: PieceId | null; newPiece: boolean; deck: DeckColor | null; order: PuzzleId[] }
  const empty: Selection = { key: resetKey, mode: null, source: null, requested: null, newPiece: false, deck: null, order: [] }
  const [saved, setSaved] = useState<Selection>(empty)
  const selection = saved.key === resetKey ? saved : empty
  const change = (patch: Partial<Selection>) => setSaved({ ...selection, ...patch })
  const master = selection.mode === 'master'
  const upgrading = selection.mode === 'upgrade'
  const cancel = () => { setSaved(empty); onBatch([]) }
  const commit = (action: GameAction) => { if (!enabled) return; onAction(action); setSaved(empty) }
  const hasPlacement = !!player && player.unfinished.some((puzzle) => PIECE_IDS.some((piece) => player.supply[piece] > 0 && legalPlacements(player, puzzle.puzzleId, piece).length > 0))
  const newOptions = acquisitionCandidates(reserve, 'single')
  const source = selection.source && player && player.supply[selection.source] > 0 ? selection.source : null
  const exchangeReserve = source ? { ...reserve, [source]: reserve[source] + 1 } : reserve
  const requested = selection.requested
  const fallback = requested !== null || selection.newPiece
  const reserveChoices = fallback ? acquisitionCandidates(selection.newPiece ? reserve : exchangeReserve, requested ?? 'single') : source ? PIECE_IDS.filter((piece) => PIECES[piece].level <= PIECES[source].level + 1) : []
  const takeNew = () => {
    if (newOptions.length === 1) commit({ type: 'upgrade', kind: 'new', piece: newOptions[0] })
    else change({ mode: 'upgrade', source: null, newPiece: true, requested: null })
  }
  const chooseReserve = (piece: PieceId) => {
    if (selection.newPiece) { commit({ type: 'upgrade', kind: 'new', piece }); return }
    if (!source) return
    const options = acquisitionCandidates(exchangeReserve, piece)
    if (requested) commit({ type: 'upgrade', kind: 'exchange', returnPiece: source, requestedPiece: requested, piece })
    else if (options.length === 1) commit({ type: 'upgrade', kind: 'exchange', returnPiece: source, requestedPiece: piece, piece: options[0] })
    else change({ requested: piece })
  }
  const reserveInteraction: ReserveInteraction | undefined = upgrading && (source || selection.newPiece) ? {
    choices: reserveChoices,
    counts: selection.newPiece ? reserve : exchangeReserve,
    source,
    label: selection.newPiece ? 'Single unavailable. Choose a replacement · 1 action.' : requested ? `${PIECE_LABELS[requested]} unavailable. Choose a replacement · 1 action.` : `Choose a replacement for ${PIECE_LABELS[source!]}.`,
    onChoose: chooseReserve,
    onBack: requested ? () => change({ requested: null, newPiece: false }) : undefined,
    onCancel: cancel,
  } : undefined
  const recycle: RecycleInteraction | undefined = selection.mode === 'recycle' ? {
    deck: selection.deck, order: selection.order,
    onDeck: (deck) => change({ deck, order: market[deck].filter((id): id is PuzzleId => id !== null) }),
    onMove: (from, to) => { const order = [...selection.order]; if (from < 0 || to < 0 || from >= order.length || to >= order.length) return; const [id] = order.splice(from, 1); order.splice(to, 0, id); change({ order }) },
    onConfirm: () => { if (selection.deck) commit({ type: 'recycle', deck: selection.deck, bottomOrder: selection.order }) },
    onCancel: cancel,
  } : undefined

  const toolbar = enabled ? <div className="table-actions">
    {master ? <div className="table-action-strip master-strip" role="group" aria-label="Master placements">
      <span><strong>{batch.length} puzzle{batch.length === 1 ? '' : 's'} staged</strong><small>One piece per puzzle · 1 action total</small></span>
      <button type="button" disabled={!batch.length} onClick={() => onBatch((items) => items.slice(0, -1))}>Undo last</button>
      <button type="button" className="primary-button" disabled={!batch.length} onClick={() => commit({ type: 'master', placements: batch })}>Play Master · 1 action</button>
      <button type="button" onClick={cancel}>Cancel</button>
    </div> : <>
      {!masterUsed && !hasPlacement && <details className="gv-extra-actions"><summary>Need to spend an action?</summary><p>Master can be used without placing a piece. This spends 1 action and uses your Master for this turn.</p><button type="button" onClick={() => commit({ type: 'master', placements: [] })}>Spend empty Master · 1 action</button></details>}
    </>}
  </div> : null

  const tableTools: TableTools = {
    canStart: enabled && selection.mode === null,
    canTakePiece: enabled && selection.mode === null && newOptions.length > 0,
    onTakePiece: takeNew,
    onExchange: (piece) => { if (enabled && selection.mode === null) change({ mode: 'upgrade', source: piece, requested: null, newPiece: false }) },
    onRecycle: (deck) => { if (enabled && selection.mode === null) change({ mode: 'recycle', deck, order: market[deck].filter((id): id is PuzzleId => id !== null) }) },
    onMaster: () => { if (enabled && selection.mode === null && hasPlacement && !masterUsed) { onBatch([]); change({ mode: 'master' }) } },
    hasPlacement, masterUsed,
  }
  return { tableTools, master, upgrading, recycle: enabled ? recycle : undefined, reserveInteraction: enabled ? reserveInteraction : undefined, toolbar, canPlace: enabled && !upgrading && !recycle, canTake: enabled && !master && !upgrading && !recycle, trayExchange: enabled && upgrading ? { selected: source, onSelect: (piece: PieceId) => change({ source: piece, requested: null, newPiece: false }) } : undefined }
}
