import { useState } from 'react'
import { PIECES } from '../game/pieces.js'
import { PIECE_LABELS } from '../game/piece-labels.js'
import { getPuzzle } from '../game/puzzles.js'
import type { PuzzleId } from '../game/puzzles.js'
import type { ReplayDecision } from '../game/replay.js'
import type { CompletionState } from '../game/state.js'

export function CompletionOrder({ puzzleIds, onSubmit }: {
  puzzleIds: readonly PuzzleId[]
  onSubmit: (decision: ReplayDecision) => void
}) {
  const [order, setOrder] = useState([...puzzleIds])
  const move = (index: number, delta: number) => {
    setOrder((current) => {
      const next = [...current]
      const target = index + delta
      if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  return <div className="control-section">
    <h3>Choose completion order</h3>
    <p>Rewards resolve in this order.</p>
    <div className="order-list">{order.map((id, index) => {
      const puzzle = getPuzzle(id)
      return <div className="order-row" key={id}>
        <span className={`puzzle-order-card puzzle-card-${puzzle.deck}`}>
          <svg className="puzzle-order-shape" viewBox={`0 0 ${puzzle.shape.width} ${puzzle.shape.height}`} aria-hidden="true">
            {puzzle.shape.cells.map(({ x, y }) => <rect key={`${x}-${y}`} x={x + .06} y={y + .06} width=".88" height=".88" rx=".12" />)}
          </svg>
          <span className="puzzle-order-meta"><strong>Puzzle {puzzle.sourceNumber}</strong><small>{puzzle.points} {puzzle.points === 1 ? 'point' : 'points'}</small></span>
        </span>
        <span className="order-arrows">
          <button aria-label={`Move Puzzle ${puzzle.sourceNumber} earlier`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button aria-label={`Move Puzzle ${puzzle.sourceNumber} later`} disabled={index === order.length - 1} onClick={() => move(index, 1)}>↓</button>
        </span>
      </div>
    })}</div>
    <button className="primary-button" onClick={() => onSubmit({ type: 'completion-order', order })}>Confirm order</button>
  </div>
}

export function CompletionRewards({ completion, onSubmit }: {
  completion: Extract<CompletionState, { status: 'resolve-rewards' }>
  onSubmit: (decision: ReplayDecision) => void
}) {
  const puzzle = getPuzzle(completion.puzzleId)
  return <div className="control-section">
    <h3>Puzzle {puzzle.sourceNumber} complete</h3>
    <p>{puzzle.points} points earned. Choose a piece reward.</p>
    <div className="piece-choices" role="group" aria-label="Completion piece rewards">
      {completion.candidates.map((piece) => {
        const shape = PIECES[piece].shape
        return <button className="piece-choice" key={piece} onClick={() => onSubmit({ type: 'completion-reward', piece })}>
          <svg className={`piece-glyph piece-${piece}`} viewBox={`0 0 ${shape.width} ${shape.height}`} aria-hidden="true">
            {shape.cells.map(({ x, y }) => <rect key={`${x}-${y}`} x={x + .06} y={y + .06} width=".88" height=".88" rx=".12" />)}
          </svg>
          <span>{PIECE_LABELS[piece]}</span>
        </button>
      })}
    </div>
  </div>
}

export function FinishingTouchesControls({ count, onUndo, onClear, onFinish }: {
  count: number
  onUndo: () => void
  onClear: () => void
  onFinish: () => void
}) {
  return <div className="control-section">
    <h3>Finishing Touches</h3>
    <p>Each placed piece costs one point.</p>
    <div className="button-row">
      <span>{count} staged · {count} point penalty</span>
      <button disabled={!count} onClick={onUndo}>Undo last</button>
      <button className="primary-button" onClick={onFinish}>{count ? 'Finish turn' : 'Finish without placing'}</button>
      <button disabled={!count} onClick={onClear}>Clear staged</button>
    </div>
  </div>
}
