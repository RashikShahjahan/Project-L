import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import type { GameAction } from '../game/engine.js'
import { getPuzzle } from '../game/puzzles.js'
import type { DeckColor, PuzzleId } from '../game/puzzles.js'
import { PIECES, PIECE_IDS } from '../game/pieces.js'
import type { PieceId } from '../game/pieces.js'
import { PIECE_LABELS } from '../game/piece-labels.js'
import type { Placement, PlayerId, PlayerState, UnfinishedPuzzle } from '../game/state.js'
import type { PlayerView } from '../online/protocol.js'
import { GameGuide } from './GameGuide.js'
import { advanceTutorialStep, dismissTutorial, shouldOpenTutorial } from './tutorial.js'
import type { ConfirmedTutorialEvent } from './tutorial.js'
import type { RecycleInteraction, ReserveInteraction, TableTools } from './useTableActions.js'
import './TableActions.css'
import './Tabletop.css'

export interface GameViewProps {
  state: PlayerView
  gameId: string
  turnStatus: string
  tutorialEvents: readonly ConfirmedTutorialEvent[]
  onAction: (action: GameAction) => void
  canAct?: boolean
  viewerCanAct?: boolean
  canTake?: boolean
  onPiecePickup?: () => void
  onPlacementError?: (message: string) => void
  masterMode?: boolean
  stagedPuzzleIds?: readonly PuzzleId[]
  menu?: ReactNode
  children?: ReactNode
  trayExchange?: { selected: PieceId | null; onSelect: (piece: PieceId) => void }
  reserveInteraction?: ReserveInteraction
  tableTools?: TableTools
  recycle?: RecycleInteraction
}

const COLORS: Record<DeckColor, string> = { white: 'White', black: 'Black' }

function transformedOrientation(piece: PieceId, current: number, flip: boolean): number {
  const orientations = PIECES[piece].orientations
  const transformed = orientations[current % orientations.length].cells.map(({ x, y }) => flip ? { x: -x, y } : { x: -y, y: x })
  const minX = Math.min(...transformed.map((cell) => cell.x))
  const minY = Math.min(...transformed.map((cell) => cell.y))
  const key = transformed.map(({ x, y }) => `${x - minX},${y - minY}`).sort().join(';')
  return orientations.findIndex((shape) => shape.cells.map(({ x, y }) => `${x},${y}`).sort().join(';') === key)
}

function PuzzleSvg({ puzzleId, placements = [] }: { puzzleId: PuzzleId; placements?: readonly Placement[] }) {
  const puzzle = getPuzzle(puzzleId)
  const size = 26
  const padded = (placement: Placement, color: string) => {
    const shape = PIECES[placement.piece].orientations[placement.orientation]
    return shape.cells.map((cell, i) => <rect key={`${placement.piece}-${placement.origin.x + cell.x}-${placement.origin.y + cell.y}-${i}`} x={placement.origin.x * size + cell.x * size - .15} y={placement.origin.y * size + cell.y * size - .15} width={size + .3} height={size + .3} fill={color} className="gv-piece-cell" />)
  }
  return <svg className="gv-puzzle-svg" viewBox={`0 0 ${puzzle.shape.width * size} ${puzzle.shape.height * size}`} role="img" aria-label={`Puzzle ${puzzle.sourceNumber}`}>
    {Array.from({length:puzzle.shape.width * puzzle.shape.height},(_,i) => <circle key={`dot-${i}`} cx={(i % puzzle.shape.width + .5) * size} cy={(Math.floor(i / puzzle.shape.width) + .5) * size} r="1.15" className="gv-grid-dot" />)}
    {puzzle.shape.cells.map(({x,y}) => <rect key={`${x}-${y}`} x={x*size-.15} y={y*size-.15} width={size+.3} height={size+.3} className="gv-empty-cell" />)}
    {placements.flatMap((p) => padded(p, `var(--piece-${p.piece})`))}
  </svg>
}

function PieceGlyph({ id, orientation = 0 }: { id: PieceId; orientation?: number }) {
  const cells = PIECES[id].orientations[orientation % PIECES[id].orientations.length].cells
  return <span className={`gv-mini-piece piece-${id}`} aria-hidden="true" style={{ '--piece-width': Math.max(...cells.map((cell) => cell.x)) + 1, '--piece-height': Math.max(...cells.map((cell) => cell.y)) + 1 } as CSSProperties}>{cells.map(c => <i key={`${c.x}-${c.y}`} style={{gridColumn:c.x+1,gridRow:c.y+1}} />)}</span>
}

function PieceOptions({ anchor, enabled, children, onClose }: { anchor: HTMLButtonElement; enabled: boolean; children: ReactNode; onClose: () => void }) {
  const popoverRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const popover = popoverRef.current
    if (!popover) return
    if (!enabled) { popover.hidePopover(); return }
    popover.showPopover()
    const position = () => {
      const pieceRect = anchor.getBoundingClientRect()
      const menuRect = popover.getBoundingClientRect()
      const left = Math.max(8, Math.min(pieceRect.left + pieceRect.width / 2 - menuRect.width / 2, window.innerWidth - menuRect.width - 8))
      const top = pieceRect.top - menuRect.height - 10
      popover.style.left = `${left}px`
      popover.style.top = `${Math.max(8, Math.min(top >= 8 ? top : pieceRect.bottom + 10, window.innerHeight - menuRect.height - 8))}px`
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [anchor, enabled])
  return <div ref={popoverRef} popover="auto" className="gv-piece-controls" role="group" aria-label="Selected piece options" onToggle={(event) => { if (event.newState === 'closed') onClose() }}>{children}</div>
}

function fits(target: UnfinishedPuzzle, placement: Placement): boolean {
  const shape = getPuzzle(target.puzzleId).shape
  const valid = new Set(shape.cells.map(({x,y}) => `${x},${y}`))
  const used = new Set(target.placements.flatMap((p) => PIECES[p.piece].orientations[p.orientation].cells.map(({x,y}) => `${x+p.origin.x},${y+p.origin.y}`)))
  return PIECES[placement.piece].orientations[placement.orientation].cells.every(({x,y}) => valid.has(`${x+placement.origin.x},${y+placement.origin.y}`) && !used.has(`${x+placement.origin.x},${y+placement.origin.y}`))
}

type BoardPlayer = Omit<PlayerState, 'completed'> & { readonly completed?: readonly PuzzleId[] }

function PlayerBoard({ player, active, selectedId, onSelect, onAction, canAct, viewerCanAct, visibleScores, finalScore, gameFinished = false, masterMode = false, finishingTouches = false, stagedPuzzleIds = [], onPiecePickup, onPlacementError, onCompleteStart, viewerPlayerId, actionsRemaining = 0, trayExchange, tableTools, children }: {
  player: BoardPlayer; active: boolean; selectedId: PuzzleId | null; onSelect: (id: PuzzleId) => void
  onAction: (action: GameAction) => void; canAct: boolean; viewerCanAct?: boolean; visibleScores: boolean; finalScore?: number; gameFinished?: boolean
  masterMode?: boolean; finishingTouches?: boolean; stagedPuzzleIds?: readonly PuzzleId[]
  onPiecePickup?: () => void; onPlacementError?: (message: string) => void; onCompleteStart?: (puzzleId: PuzzleId, origin: DOMRect) => void; viewerPlayerId?: PlayerId
  actionsRemaining?: number; children?: ReactNode; tableTools?: TableTools; trayExchange?: GameViewProps['trayExchange']
}) {
  const [pieceChoice, setPieceChoice] = useState<PieceId>('single')
  const [orientation, setOrientation] = useState(0)
  const [pieceOptions, setPieceOptions] = useState<{ piece: PieceId; anchor: HTMLButtonElement } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const availablePieces = PIECE_IDS.filter((id) => player.supply[id] > 0)
  const piece = availablePieces.includes(pieceChoice) ? pieceChoice : availablePieces[0] ?? 'single'
  const orientations = PIECES[piece].orientations
  const [hovered, setHovered] = useState<{puzzleId: PuzzleId;x:number;y:number} | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dragPosition, setDragPosition] = useState({x: 0, y: 0})
  const dragPiece = useRef<{ piece: PieceId; orientation: number; startX: number; startY: number; moved: boolean } | null>(null)
  const pointerDragged = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const [placementMessage, setPlacementMessage] = useState('')
  const reportPlacementError = () => {
    const message = 'That piece does not fit here. Try another square or rotate it.'
    if (onPlacementError) onPlacementError(message)
    else setPlacementMessage(message)
  }
  const [snapCells, setSnapCells] = useState<ReadonlySet<string>>(new Set())
  const staged = new Set(stagedPuzzleIds)
  const targets = player.unfinished.filter((puzzle) => !masterMode || !staged.has(puzzle.puzzleId))
  const selectedTarget = targets.find((puzzle) => puzzle.puzzleId === selectedId)
  const puzzleOrder = player.unfinished
  const preview = (origin: {x:number;y:number}) => ({ piece, orientation: orientation % orientations.length, origin })
  const totalPieces = PIECE_IDS.reduce((n,id)=>n+player.supply[id],0)
  useEffect(() => {
    if (!active || !selectedId || !window.matchMedia('(max-width: 700px)').matches) return
    const stage = stageRef.current
    const board = stage?.querySelector('.gv-placement-board')
    const dock = stage?.nextElementSibling
    if (board && dock && board.getBoundingClientRect().bottom > dock.getBoundingClientRect().top) {
      stage?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
  }, [active, selectedId, totalPieces])
  const showOwnScore = viewerPlayerId ? viewerPlayerId === player.id : active
  const completed = player.completed
  const placeAt = (target: UnfinishedPuzzle, placement: Placement, originRect?: DOMRect) => {
    if (!fits(target, placement)) return
    setPlacementMessage('')
    setPieceOptions(null)
    setHovered(null)
    const cells = PIECES[placement.piece].orientations[placement.orientation].cells.map(({x,y}) => `${x + placement.origin.x},${y + placement.origin.y}`)
    setSnapCells(new Set(cells))
    window.setTimeout(() => setSnapCells(new Set()), 520)
    if (!masterMode && originRect && target.placements.reduce((total, placed) => total + PIECES[placed.piece].level, 0) + PIECES[placement.piece].level === getPuzzle(target.puzzleId).shape.cells.length) onCompleteStart?.(target.puzzleId, originRect)
    onAction({type:'place', puzzleId:target.puzzleId, placement})
  }
  const cellAtPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-gv-cell]')
    const card = cell?.closest<HTMLElement>('[data-work-puzzle]')
    const target = targets.find((puzzle) => puzzle.puzzleId === card?.dataset.workPuzzle)
    if (!cell || !card || !target || !stageRef.current?.contains(card)) return null
    const [x, y] = cell.dataset.gvCell!.split(',').map(Number)
    return { cell, target, origin: { x, y } }
  }

  return <section className={`gv-player ${active ? 'is-active' : 'is-compact'} ${trayExchange ? 'is-exchanging' : ''}`} onKeyDown={(event) => {
    if (!active || !canAct || !selectedTarget || event.ctrlKey || event.metaKey || event.altKey || !['r', 'f'].includes(event.key.toLowerCase())) return
    if ((event.target as HTMLElement).closest('input, select, textarea, [contenteditable]')) return
    event.preventDefault()
    setOrientation(transformedOrientation(piece, orientation, event.key.toLowerCase() === 'f'))
  }}>
    {!active && <header className="gv-player-head"><button className="gv-player-toggle gv-seat-toggle" type="button" aria-label={`${expanded ? 'Hide' : 'Show'} ${player.name} board`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><span>{player.name}</span><span>{finalScore !== undefined ? `${finalScore} pts` : visibleScores || showOwnScore ? completed ? `${completed.reduce((total, id) => total + getPuzzle(id).points, 0)} pts` : 'Score hidden' : 'Score hidden'}</span><span aria-hidden="true">⌄</span></button></header>}
    {(active || expanded) && <div className="gv-board-content">
      <div className="gv-stage" ref={stageRef}>
        {active && <aside className="gv-turn-panel"><span className="gv-eyebrow" key={player.id}>{player.name}</span><h2>{gameFinished ? 'Game complete.' : finishingTouches ? 'Finishing touches.' : viewerPlayerId && !(viewerCanAct ?? canAct) ? 'Waiting for your turn.' : 'Your move.'}</h2>{!finishingTouches && !gameFinished && <div className="gv-action-tokens" role="img" aria-label={`${actionsRemaining} of 3 actions remaining`}>{[0,1,2].map((n) => <i key={n} className={n < actionsRemaining ? 'available' : ''}>{n + 1}</i>)}<span>{actionsRemaining} {actionsRemaining === 1 ? 'action' : 'actions'} left</span></div>}{tableTools && !gameFinished && !finishingTouches && <button type="button" className="gv-master-token" disabled={!tableTools.canStart || !tableTools.hasPlacement || tableTools.masterUsed} title={tableTools.masterUsed ? 'Already used this turn' : !tableTools.hasPlacement ? 'Take a puzzle and a piece that fits to use Master' : 'Place one piece on each puzzle for 1 action, once per turn'} onClick={tableTools.onMaster}><b aria-hidden="true">M</b><span>Master<small>{tableTools.masterUsed ? 'Used this turn' : '1 per puzzle · 1 action'}</small></span></button>}</aside>}
        <div className="gv-stage-center">
      <div className="gv-section-title"><h3>{active ? 'Your workbench' : `${player.name}'s puzzles`}</h3><span>{player.unfinished.length} / 4 puzzles</span></div>
      <p className={`gv-workbench-help ${masterMode || finishingTouches || trayExchange ? 'is-contextual' : ''}`}>{gameFinished ? 'Your final puzzles and score.' : finishingTouches ? 'Each extra piece costs 1 point. Finish when you are ready.' : masterMode ? 'Place one piece on each puzzle, then confirm below.' : trayExchange ? 'Choose a piece below, then its replacement in the shared supply.' : player.unfinished.length ? 'Choose a piece below. Click a square on any puzzle to place it.' : 'Take a tile from the market to begin.'}</p>
      <div className="gv-puzzles">
        {puzzleOrder.map((puzzle) => {
          const def = getPuzzle(puzzle.puzzleId)
          const filledCells = puzzle.placements.reduce((total, placed) => total + PIECES[placed.piece].level, 0)
          const remainingCells = def.shape.cells.length - filledCells
          const progressLabel = `${remainingCells} ${remainingCells === 1 ? 'square' : 'squares'} left`
          const isSelected = puzzle.puzzleId === selectedId
          const isStaged = masterMode && staged.has(puzzle.puzzleId)
          const target = preview(hovered?.puzzleId === puzzle.puzzleId ? hovered : {x:0,y:0})
          const candidateLegal = fits(puzzle, target)
          const ghostCells = new Set(PIECES[piece].orientations[target.orientation].cells.map(({x,y}) => `${x+target.origin.x},${y+target.origin.y}`))
          const ghostInside = PIECES[piece].orientations[target.orientation].cells.every(({x,y}) => def.shape.cells.some((cell) => cell.x === x+target.origin.x && cell.y === y+target.origin.y))
          const legalGhost = candidateLegal && ghostInside
          const occupied = new Map<string, PieceId>()
          for (const placed of puzzle.placements) for (const cell of PIECES[placed.piece].orientations[placed.orientation].cells) occupied.set(`${placed.origin.x + cell.x},${placed.origin.y + cell.y}`, placed.piece)
          const showInteractive = active && !isStaged
          return <article key={puzzle.puzzleId} data-work-puzzle={puzzle.puzzleId} style={{ '--active-card-width': `${Math.max(230, def.shape.width * 44 + 32)}px` } as CSSProperties} className={`gv-work-card ${def.deck} ${isSelected ? 'selected' : ''} ${isStaged ? 'gv-staged' : ''}`}>
            {showInteractive ? <div className="gv-select-card gv-interactive-card">
              <span className="gv-puzzle-summary"><b>{def.points} <small>{def.points === 1 ? 'pt' : 'pts'}</small></b><span>#{String(def.sourceNumber).padStart(2,'0')}</span><span className="gv-work-reward" aria-label={`Reward: ${PIECE_LABELS[def.reward]}`}><small>Reward</small><PieceGlyph id={def.reward} /></span>{masterMode && <span className="gv-stage-badge">Master</span>}</span>
              <div className="gv-placement-board" style={{'--cols': def.shape.width} as CSSProperties} aria-label={`Place ${PIECE_LABELS[piece]} in puzzle ${def.sourceNumber}`}>
                {Array.from({length:def.shape.width * def.shape.height},(_,index)=>({x:index % def.shape.width,y:Math.floor(index / def.shape.width)})).map(({x,y}) => {
                  const key = `${x},${y}`
                  const inPuzzle = def.shape.cells.some((cell) => cell.x === x && cell.y === y)
                  if (!inPuzzle) return <span key={key} className="gv-board-cell hole" aria-hidden="true" />
                  const placement = preview({x,y}), legal = availablePieces.length > 0 && fits(puzzle, placement)
                  const placedPiece = occupied.get(key)
                  const inGhost = canAct && availablePieces.length > 0 && hovered?.puzzleId === puzzle.puzzleId && ghostCells.has(key)
                  return <button type="button" key={key} data-gv-cell={`${x},${y}`} className={`gv-board-cell ${placedPiece ? 'occupied' : ''} ${placedPiece && snapCells.has(key) ? 'gv-placement-snap' : ''} ${inGhost ? (legalGhost ? 'gv-ghost-valid' : 'gv-ghost-invalid') : ''} ${legal ? 'legal' : ''}`} style={placedPiece ? {'--tile-color': `var(--piece-${placedPiece})`} as CSSProperties : undefined} disabled={!canAct || availablePieces.length === 0} onMouseEnter={() => setHovered({puzzleId: puzzle.puzzleId,x,y})} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered({puzzleId: puzzle.puzzleId,x,y})} onBlur={() => setHovered(null)} onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return
                    event.preventDefault()
                    const delta = event.key === 'ArrowLeft' ? [-1,0] : event.key === 'ArrowRight' ? [1,0] : event.key === 'ArrowUp' ? [0,-1] : [0,1]
                    let nx = x + delta[0], ny = y + delta[1]
                    while (nx >= 0 && ny >= 0 && nx < def.shape.width && ny < def.shape.height && !def.shape.cells.some((cell) => cell.x === nx && cell.y === ny)) { nx += delta[0]; ny += delta[1] }
                    const next = event.currentTarget.closest('.gv-placement-board')?.querySelector<HTMLButtonElement>(`[data-gv-cell="${nx},${ny}"]`)
                    next?.focus()
                  }} onClick={(event) => { if (legal) { onSelect(puzzle.puzzleId); placeAt(puzzle, placement, event.currentTarget.closest('.gv-work-card')?.getBoundingClientRect()); } else reportPlacementError() }} title={legal ? `Place ${PIECE_LABELS[piece]} at ${x+1}, ${y+1}` : 'This piece does not fit here'} aria-label={`${legal ? 'Place' : 'Cannot place'} ${PIECE_LABELS[piece]} at column ${x+1}, row ${y+1}`} />
                })}
              </div>
              <div className="gv-card-bottom" aria-live="polite">{progressLabel}{masterMode ? ' · Master · 1 action total' : finishingTouches ? ' · −1 point per piece' : canAct ? ' · Place · 1 action' : ''}</div>
              {masterMode && staged.has(puzzle.puzzleId) && <span className="gv-stage-badge">Staged</span>}
            </div> : <button className="gv-select-card" type="button" disabled={!active || isStaged} onClick={() => { setHovered(null); onSelect(puzzle.puzzleId) }} aria-pressed={isSelected}><span className="gv-puzzle-summary"><b>{def.points} <small>{def.points === 1 ? 'pt' : 'pts'}</small></b><span>#{String(def.sourceNumber).padStart(2,'0')}</span><span className="gv-work-reward" aria-label={`Reward: ${PIECE_LABELS[def.reward]}`}><small>Reward</small><PieceGlyph id={def.reward} /></span>{masterMode && isStaged && <span className="gv-stage-badge">Staged</span>}</span><PuzzleSvg puzzleId={puzzle.puzzleId} placements={puzzle.placements} /><span className="gv-card-bottom">{progressLabel}{masterMode && isStaged ? ' · Staged' : ' · Next up'}</span></button>}
          </article>
        })}
        {puzzleOrder.length < 4 && <button type="button" className={`gv-open-space ${puzzleOrder.length === 0 ? 'gv-first-space' : ''}`} disabled={!active || viewerCanAct === false && Boolean(viewerPlayerId) || finishingTouches || gameFinished || masterMode || Boolean(trayExchange)} onClick={() => { document.querySelector<HTMLButtonElement>('.gv-mobile-market-toggle[aria-expanded="false"]')?.click(); document.querySelector('.gv-market')?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); document.querySelector<HTMLButtonElement>('.gv-market-card:not(:disabled)')?.focus({preventScroll: true}) }}><span aria-hidden="true">↖</span>{puzzleOrder.length === 0 ? 'Choose a tile from above' : `${4 - puzzleOrder.length} open ${puzzleOrder.length === 3 ? 'space' : 'spaces'}`}</button>}

      </div>
        </div>
        {active && <aside className="gv-score-panel" aria-label="Your score and completed puzzles"><div className="gv-score-total"><b>{finalScore !== undefined ? finalScore : showOwnScore || visibleScores ? completed?.reduce((total, id) => total + getPuzzle(id).points, 0) ?? '—' : '—'}</b><span>{finalScore !== undefined ? 'FINAL SCORE' : showOwnScore || visibleScores ? completed ? 'POINTS' : 'SCORE HIDDEN' : 'SCORE HIDDEN'}</span></div>{showOwnScore || visibleScores ? completed ? completed.length ? <details className="gv-completed-details"><summary>{completed.length} completed</summary><div className="gv-completed-cards">{completed.map((id, index) => <div className={`gv-completed-card ${getPuzzle(id).deck}`} data-completed-puzzle={id} key={`${id}-${index}`} title={`Puzzle ${getPuzzle(id).sourceNumber}, ${getPuzzle(id).points} points`}><PuzzleSvg puzzleId={id} /><b>{getPuzzle(id).points} pts</b></div>)}</div></details> : <small className="gv-completed-count">0 completed</small> : null : null}</aside>}
      </div>
      <div className="gv-dock">
      <div className="gv-dock-tray">
        <div className="gv-section-title gv-inventory-title"><h3>{active ? 'Your pieces' : `${player.name}'s pieces`}</h3><span>{totalPieces} available</span></div>
        <div className="gv-inventory gv-piece-tray" role="group" aria-label={active ? 'Choose a piece to place' : `${player.name} piece supply`}>{PIECE_IDS.filter((id) => player.supply[id] > 0).map((id) => <button type="button" className={`gv-inventory-item gv-piece-choice ${active && (trayExchange ? trayExchange.selected === id : piece === id) ? 'selected' : ''}`} key={id} title={`${PIECE_LABELS[id]}, ${player.supply[id]} available`} aria-label={trayExchange ? `Exchange ${PIECE_LABELS[id]}, ${player.supply[id]} available` : `${PIECE_LABELS[id]}, ${player.supply[id]} available`} aria-pressed={active ? trayExchange ? trayExchange.selected === id : piece === id : undefined} disabled={trayExchange ? !active : !canAct} aria-expanded={active && !trayExchange ? canAct && pieceOptions?.piece === id : undefined}
          onClick={(event) => { if (trayExchange) { trayExchange.onSelect(id); return } if (event.detail > 0 && pointerDragged.current) return; setPieceChoice(id); setPieceOptions({ piece: id, anchor: event.currentTarget }); setHovered(null); if (id !== piece) setOrientation(0); onPiecePickup?.() }}
          onPointerDown={(event) => {
            if (trayExchange || event.button !== 0 || !canAct || !selectedTarget) return
            pointerDragged.current = false
            dragPiece.current = { piece: id, orientation: id === piece ? orientation % orientations.length : 0, startX: event.clientX, startY: event.clientY, moved: false }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const dragged = dragPiece.current
            if (!dragged) return
            if (!dragged.moved && Math.hypot(event.clientX - dragged.startX, event.clientY - dragged.startY) < 5) return
            if (!dragged.moved) { setPieceOptions(null); dragged.moved = true; pointerDragged.current = true; setPieceChoice(dragged.piece); setOrientation(dragged.orientation); setDragging(true); onPiecePickup?.() }
            setDragPosition({x: event.clientX, y: event.clientY})
            const hit = cellAtPointer(event)
            setHovered(hit ? {puzzleId: hit.target.puzzleId, ...hit.origin} : null)
          }}
          onPointerUp={(event) => {
            const dragged = dragPiece.current
            dragPiece.current = null
            setDragging(false)
            setHovered(null)
            if (!dragged?.moved || !canAct || !selectedTarget || player.supply[dragged.piece] <= 0) return
            const hit = cellAtPointer(event)
            if (!hit) return
            const placement = { piece: dragged.piece, orientation: dragged.orientation, origin: hit.origin }
            if (fits(hit.target, placement)) { onSelect(hit.target.puzzleId); placeAt(hit.target, placement, hit.cell.closest('.gv-work-card')?.getBoundingClientRect()) }
            else reportPlacementError()
          }}
          onPointerCancel={() => { dragPiece.current = null; setDragging(false); setHovered(null) }}
        ><PieceGlyph id={id} orientation={active && piece === id ? orientation : 0} /><b>{player.supply[id]}</b><small>{PIECE_LABELS[id]}</small></button>)}{!availablePieces.length && <span className="gv-inventory-empty">No pieces available</span>}
      {pieceOptions?.piece === piece && <PieceOptions anchor={pieceOptions.anchor} enabled={active && canAct && !trayExchange && !dragging} onClose={() => setPieceOptions(null)}>
        <span className="gv-selected-piece">{PIECE_LABELS[piece]} selected</span>
        <div className="gv-transform-row">
          <button type="button" disabled={!selectedTarget || transformedOrientation(piece, orientation, false) === orientation % orientations.length} onClick={() => setOrientation(transformedOrientation(piece, orientation, false))} aria-label={`Rotate selected ${PIECE_LABELS[piece]}, orientation ${orientation % orientations.length + 1} of ${orientations.length}`}>↻ Rotate</button>
          <button type="button" disabled={!selectedTarget || transformedOrientation(piece, orientation, true) === orientation % orientations.length} onClick={() => setOrientation(transformedOrientation(piece, orientation, true))} aria-label={`Flip selected ${PIECE_LABELS[piece]}, orientation ${orientation % orientations.length + 1} of ${orientations.length}`}>⇄ Flip</button>
          {tableTools && <button type="button" className="gv-exchange-piece" disabled={!tableTools.canStart} onClick={() => { setPieceOptions(null); tableTools.onExchange(piece) }}>↗ Exchange <small>1 action</small></button>}
        </div>
        <small>{masterMode ? 'One piece per puzzle' : 'R rotate · F flip'}</small>
      </PieceOptions>}
        </div>
        {placementMessage && <p className="gv-placement-message" role="alert">{placementMessage}</p>}
        {dragging && selectedTarget && <span className="gv-drag-hint">Drop a piece on the puzzle board</span>}
      </div>
      {dragging && <span className="gv-floating-piece" style={{left: dragPosition.x, top: dragPosition.y}}><PieceGlyph id={piece} orientation={orientation} /></span>}
      {active && children && <div className="gv-dock-actions">{children}</div>}
      </div>
    </div>}
  </section>
}

export function GameView({ state, gameId, turnStatus, tutorialEvents, onAction, canAct = true, viewerCanAct, canTake = canAct, onPiecePickup, onPlacementError, masterMode = false, stagedPuzzleIds = [], menu, children, trayExchange, reserveInteraction, recycle, tableTools }: GameViewProps) {
  const viewerPlayerId = state.viewerId
  const phase = state.phase
  const players: readonly BoardPlayer[] = state.players.map((player) => ({ ...player, supply: player.id === state.viewerId ? state.ownSupply : player.supply }))
  const activeId = state.activePlayerId
  const actingPlayer = players.find(p => p.id === activeId)
  const activePlayer = players.find((p) => p.id === state.viewerId)
  const market = state.market
  const counts = state.deckCounts
  const reserve = state.reserve
  const visibleScores = state.config.visibleScores
  const round = state.round
  const actionsRemaining = state.actionsRemaining ?? 0
  const blackTakesAfterTrigger = state.blackTakesAfterTrigger
  const endgame = state.endgame
  const completionState = state.completion
  const turnReason = phase === 'finishing-touches' ? 'Market closed during Finishing Touches.'
    : phase === 'scored' ? 'The game is complete.'
      : completionState && completionState.status !== 'none' ? 'Choose your completion rewards before taking another puzzle.'
      : masterMode ? 'Finish or cancel Master placements before taking a puzzle.'
        : !canTake ? viewerCanAct === false || viewerPlayerId && activeId !== viewerPlayerId ? 'Waiting for your turn.' : 'Finish or cancel the current action before taking another puzzle.'
          : !actingPlayer ? 'No active player can take a puzzle.'
            : actingPlayer.unfinished.length >= 4 ? 'Your board is full. Complete a puzzle before taking another.'
              : ''
  const marketHelpId = 'gv-market-help'
  const marketStatus = [
    turnReason,
    endgame && blackTakesAfterTrigger >= 1 ? 'One black puzzle per turn is allowed in the final round.' : '',
    ...(['white', 'black'] as const).map((deck) => !market[deck].some(Boolean) && !counts[deck] ? `No ${deck} puzzles remain in the market or deck.` : ''),
  ].filter(Boolean).join(' ')
  const marketHelp = marketStatus || 'Take any face-up card. Fill it to earn points and the reward piece.'
  const results = state.results
  // Rejoining an underway table never interrupts play. Each room supports one
  // game; the room code and stable seat identify that player's dismissal.
  const [helpOpen, setHelpOpen] = useState(() => shouldOpenTutorial(gameId, state.viewerId,
    state.phase === 'turns' && state.round === 1 && state.actionsRemaining === 3
    && state.players.every((player) => !player.unfinished.length && !player.completed?.length
      && PIECE_IDS.every((piece) => player.supply[piece] === (piece === 'single' || piece === 'domino' ? 1 : 0)))))
  const [tutorialStep, setTutorialStep] = useState(0)
  const [guideCollapsed, setGuideCollapsed] = useState(false)
  const lastTutorialEvent = useRef(tutorialEvents.at(-1)?.id ?? 0)
  useEffect(() => {
    const events = tutorialEvents.filter((event) => event.id > lastTutorialEvent.current)
    lastTutorialEvent.current = tutorialEvents.at(-1)?.id ?? 0
    if (helpOpen && events.length) setTutorialStep((step) => events.reduce((next, event) => advanceTutorialStep(next, event.event), step))
  }, [tutorialEvents, helpOpen])
  const [localSelection, setLocalSelection] = useState<PuzzleId | null>(null)
  const [marketViewOverride, setMarketViewOverride] = useState<{ playerId: PlayerId; expanded: boolean } | null>(null)
  const marketExpanded = recycle || reserveInteraction ? true : activePlayer
    ? marketViewOverride?.playerId === activePlayer.id ? marketViewOverride.expanded : true
    : true
  const choosingReserve = Boolean(reserveInteraction)
  const recycling = Boolean(recycle)
  useEffect(() => {
    if (window.matchMedia('(max-width: 700px)').matches && (choosingReserve || recycling)) {
      document.querySelector(choosingReserve ? '.gv-reserve' : '.gv-market')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [choosingReserve, recycling])
  const puzzleDrag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const puzzleDragged = useRef(false)
  const [heldPuzzle, setHeldPuzzle] = useState<{id: PuzzleId; x: number; y: number} | null>(null)
  const draggedMarketCard = useRef<{ index: number; x: number; y: number; moved: boolean } | null>(null)
  const [recycleDropTarget, setRecycleDropTarget] = useState<number | null>(null)
  const pendingTravel = useRef<{ puzzleId?: PuzzleId; from: DOMRect; playerId: PlayerId | null } | null>(null)
  const pendingCompletion = useRef<{ puzzleId: PuzzleId; from: DOMRect; playerId: PlayerId | null } | null>(null)
  const previousTargetIds = useRef<readonly PuzzleId[]>([])
  const previousCompletedIds = useRef<readonly PuzzleId[]>([])
  const choose = (id: PuzzleId) => setLocalSelection(id)
  const targetIds = useMemo(() => state.players.find((player) => player.id === state.viewerId)?.unfinished.filter((puzzle) => !masterMode || !stagedPuzzleIds.includes(puzzle.puzzleId)).map((puzzle) => puzzle.puzzleId) ?? [], [state.players, state.viewerId, masterMode, stagedPuzzleIds])
  const effectiveSelected = localSelection && targetIds.includes(localSelection) ? localSelection : targetIds[targetIds.length - 1] ?? null
  const take = (deck: DeckColor, slot: number, from: DOMRect) => { const id = market[deck][slot]; if (id) { setLocalSelection(id); if (activeId) setMarketViewOverride({ playerId: activeId, expanded: false }); pendingTravel.current = { puzzleId: id, from, playerId: activeId }; } onAction({type:'take',source:'market',deck,slot:slot as 0|1|2|3}) }
  const takeBlind = (deck: DeckColor, from: DOMRect) => { setLocalSelection(null); if (activeId) setMarketViewOverride({ playerId: activeId, expanded: false }); pendingTravel.current = { from, playerId: activeId }; onAction({type:'take',source:'deck',deck}) }
  useEffect(() => {
    // Synchronize measured card travel after React has rendered the newly acquired puzzle.
    const added = targetIds.filter((id) => !previousTargetIds.current.includes(id))
    previousTargetIds.current = targetIds
    const pending = pendingTravel.current
    if (pending && pending.playerId !== activeId) { pendingTravel.current = null; return }
    const id = pending?.puzzleId ? added.includes(pending.puzzleId) ? pending.puzzleId : undefined : added[added.length - 1]
    if (pending && id) {
      const element = document.querySelector<HTMLElement>(`[data-work-puzzle="${id}"]`)
      if (element) {
        const destination = element.getBoundingClientRect()
        element.style.setProperty('--travel-x', `${pending.from.left - destination.left}px`)
        element.style.setProperty('--travel-y', `${pending.from.top - destination.top}px`)
        element.style.setProperty('--travel-scale', String(pending.from.width / destination.width))
        requestAnimationFrame(() => element.classList.add('gv-arriving'))
        element.addEventListener('animationend', () => element.classList.remove('gv-arriving'), { once: true })
        pendingTravel.current = null
      }
    }
  }, [activeId, targetIds])
  useEffect(() => {
    // The completed card lands only after the engine has resolved its reward.
      const completedIds = activePlayer?.completed ?? []
    const added = completedIds.filter((id) => !previousCompletedIds.current.includes(id))
    previousCompletedIds.current = completedIds
    const pending = pendingCompletion.current
    if (pending && pending.playerId !== activeId) { pendingCompletion.current = null; return }
    const id = pending && added.includes(pending.puzzleId) ? pending.puzzleId : undefined
    if (pending && id && (visibleScores || !viewerPlayerId || viewerPlayerId === activeId)) {
      const element = document.querySelector<HTMLElement>('.gv-score-panel .gv-score-total')
      if (element) {
        const destination = element.getBoundingClientRect()
        element.style.setProperty('--travel-x', `${pending.from.left - destination.left}px`)
        element.style.setProperty('--travel-y', `${pending.from.top - destination.top}px`)
        element.style.setProperty('--travel-scale', String(Math.min(2, pending.from.width / destination.width)))
        requestAnimationFrame(() => element.classList.add('gv-completing'))
        element.addEventListener('animationend', () => element.classList.remove('gv-completing'), { once: true })
        pendingCompletion.current = null
      }
    }
  }, [activeId, activePlayer?.completed, visibleScores, viewerPlayerId])

  const showTutorialTarget = () => {
    setGuideCollapsed(false)
    const selectors = ['.gv-action-tokens', '.gv-market', '.gv-player.is-active .gv-stage-center', '.gv-player.is-active .gv-stage-center', '.gv-reserve', '.gv-refresh-row, .gv-recycle-row-controls', '.gv-player.is-active .gv-master-token', '.gv-deck-stack.black']
    if ([1, 4, 5, 7].includes(tutorialStep) && activePlayer) setMarketViewOverride({ playerId: activePlayer.id, expanded: true })
    requestAnimationFrame(() => document.querySelector(selectors[tutorialStep])?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }))
  }

  return <main className={`gv-shell ${heldPuzzle ? 'is-moving-puzzle' : ''}`} data-tutorial-step={helpOpen && !guideCollapsed ? tutorialStep : undefined}>
    {heldPuzzle && <div className={`gv-held-puzzle gv-market-card ${getPuzzle(heldPuzzle.id).deck}`} style={{left: heldPuzzle.x, top: heldPuzzle.y}}><PuzzleSvg puzzleId={heldPuzzle.id} /></div>}
    <header className="gv-hud"><div className="gv-brand"><span>PROJECT</span><b>L</b></div><span className="gv-hud-round">{phase === 'turns' ? `ROUND ${String(round ?? 0).padStart(2,'0')}` : phase === 'finishing-touches' ? 'FINISHING TOUCHES' : 'GAME COMPLETE'}</span><div className="gv-opponents" aria-label="Other players">{players.filter(player => player.id !== state.viewerId).map(player => <div className="gv-seat" key={player.id}><PlayerBoard player={player} active={false} selectedId={null} onSelect={choose} onAction={onAction} canAct={false} visibleScores={visibleScores} viewerPlayerId={viewerPlayerId} finalScore={results?.find((result) => result.playerId === player.id)?.total} /></div>)}</div><div className="gv-hud-menu"><button type="button" className="guide-toggle" aria-expanded={helpOpen} aria-controls="game-rules" onClick={() => { if (!helpOpen) { setTutorialStep(0); setGuideCollapsed(false) } else dismissTutorial(gameId, state.viewerId); setHelpOpen(!helpOpen) }}>How to play</button>{menu}</div></header>
    <div className="gv-layout">
      <GameGuide open={helpOpen} step={tutorialStep} onStep={setTutorialStep} onClose={() => setHelpOpen(false)} onShowTarget={showTutorialTarget} gameId={gameId} playerId={state.viewerId} turnStatus={turnStatus} canAct={viewerCanAct ?? canAct} canPlace={canAct} canTake={canTake} collapsed={guideCollapsed} onCollapse={() => setGuideCollapsed(!guideCollapsed)} hasPuzzle={Boolean(activePlayer?.unfinished.length)} phase={phase} />
      {activePlayer && <button className="gv-mobile-market-toggle" type="button" aria-expanded={marketExpanded} aria-controls="gv-shared-table" onClick={() => setMarketViewOverride({ playerId: activePlayer.id, expanded: !marketExpanded })}><span>Market &amp; supply <small>· 1 action</small></span><span aria-hidden="true">{marketExpanded ? '−' : '+'}</span></button>}
      <div id="gv-shared-table" className={`gv-shared-table ${marketExpanded ? '' : 'is-market-collapsed'}`}>
      <section className="gv-market" aria-label="Shared puzzle market">
        <div className="gv-market-title"><div><span className="gv-eyebrow">THE SHARED TABLE</span><h1>The market</h1></div><span className="gv-cost">1 action</span>{endgame && <span className="gv-endgame">Final round {endgame.finalRound}</span>}</div>
        <p className={marketStatus ? "gv-market-help" : "gv-sr-only"} id={marketHelpId} aria-live="polite">{marketHelp}</p>
        {recycle && <div className="market-recycle-cue"><span>{recycle.deck ? 'Drag cards or use the arrows. Numbers show their future draw order.' : 'Choose a row to recycle · 1 action.'}</span><button type="button" onClick={recycle.onCancel}>Cancel recycle</button></div>}
        {(['white','black'] as const).map(deck => {
          const ordering = recycle?.deck === deck
          const row = ordering ? [...recycle.order, ...Array(Math.max(0, 4 - recycle.order.length)).fill(null)] : market[deck]
          return <div className={`gv-market-row ${deck} ${ordering ? 'is-recycling' : ''}`} key={deck}>
          <div className="gv-row-heading"><span><i className={`gv-deck-dot ${deck}`} />{deck === 'white' ? 'Build your supply' : 'Play for points'}</span><small>{deck === 'white' ? 'White puzzles' : 'Black puzzles'}</small></div>
          <button className={`gv-deck-stack ${deck}`} type="button" disabled={Boolean(turnReason) || Boolean(recycle) || phase !== 'turns' || !counts[deck] || deck === 'black' && endgame !== null && blackTakesAfterTrigger >= 1} onClick={(event) => takeBlind(deck,event.currentTarget.getBoundingClientRect())} aria-describedby={marketHelpId} aria-label={`Draw a face-down ${deck} puzzle for 1 action`}>
            <span className="gv-stack-art" aria-hidden="true"><i /></span><span className="gv-deck-count">Draw<small>{counts[deck]} left</small><span className="gv-sr-only">{COLORS[deck]}</span></span>
          </button>
          <div className="gv-market-cards">{row.map((id: PuzzleId | null,index: number) => {
            if (!id) return <div className={`gv-market-card empty ${deck}`} key={`${deck}-${index}`} aria-hidden="true" />
            const p = getPuzzle(id)
            const deckReason = deck === 'black' && endgame !== null && blackTakesAfterTrigger >= 1 ? 'One black puzzle per turn is allowed in the final round.' : ''
            const face = <><div className="gv-card-line"><strong>{p.points}<small> pt{p.points === 1 ? '' : 's'}</small></strong><span title={`Reward: ${PIECE_LABELS[p.reward]}`}><PieceGlyph id={p.reward} /></span></div><PuzzleSvg puzzleId={id}/><div className="gv-reward"><span>#{String(p.sourceNumber).padStart(2,'0')}</span><span className="gv-take-label">{ordering ? `Return ${index + 1}` : 'Take · 1 action'}</span></div></>
            return ordering ? <div className={`gv-recycle-card ${recycleDropTarget === index ? 'is-drop-target' : ''}`} key={id} data-recycle-index={index}
              onPointerDown={(event) => { if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return; draggedMarketCard.current = { index, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId) }}
              onPointerMove={(event) => {
                const dragged = draggedMarketCard.current
                if (!dragged) return
                if (Math.hypot(event.clientX - dragged.x, event.clientY - dragged.y) > 5) dragged.moved = true
                if (!dragged.moved) return
                const target = document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-recycle-index]')
                setRecycleDropTarget(target ? Number(target.dataset.recycleIndex) : null)
              }}
              onPointerUp={(event) => {
                const dragged = draggedMarketCard.current
                draggedMarketCard.current = null; setRecycleDropTarget(null)
                if (!dragged?.moved) return
                const target = document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-recycle-index]')
                if (target) recycle.onMove(dragged.index,Number(target.dataset.recycleIndex))
              }}
              onPointerCancel={() => { draggedMarketCard.current = null; setRecycleDropTarget(null) }}>
              <div className={`gv-market-card ${deck}`}>{face}</div>
              <div className="gv-recycle-arrows"><button type="button" aria-label={`Move Puzzle ${p.sourceNumber} earlier`} disabled={index === 0} onClick={() => recycle.onMove(index,index-1)}>←</button><button type="button" aria-label={`Move Puzzle ${p.sourceNumber} later`} disabled={index === recycle.order.length-1} onClick={() => recycle.onMove(index,index+1)}>→</button></div>
            </div> : <button className={`gv-market-card ${deck}`} key={id} disabled={Boolean(turnReason || deckReason || recycle)} onClick={(event) => { if (!puzzleDragged.current) take(deck,index,event.currentTarget.getBoundingClientRect()) }}
              onPointerDown={(event) => { if (event.button !== 0) return; puzzleDragged.current = false; puzzleDrag.current = { x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId) }}
              onPointerMove={(event) => { const start = puzzleDrag.current; if (!start) return; if (Math.hypot(event.clientX - start.x,event.clientY - start.y) > 6) start.moved = true; if (start.moved) { puzzleDragged.current = true; setHeldPuzzle({id, x: event.clientX, y: event.clientY}) } }}
              onPointerUp={(event) => { const start = puzzleDrag.current; puzzleDrag.current = null; setHeldPuzzle(null); if (start?.moved && document.elementFromPoint(event.clientX,event.clientY)?.closest('.gv-player.is-active .gv-stage')) take(deck,index,event.currentTarget.getBoundingClientRect()) }}
              onPointerCancel={() => { puzzleDrag.current = null; setHeldPuzzle(null) }} aria-describedby={marketHelpId} aria-label={`Take puzzle ${p.sourceNumber}, ${p.points} points, reward ${PIECE_LABELS[p.reward]}, costs 1 action`}>{face}</button>
          })}</div>
          {!recycle && tableTools && <button type="button" className="gv-refresh-row" disabled={!tableTools.canStart} onClick={() => tableTools.onRecycle(deck)} aria-label={`Recycle ${deck} row for 1 action`}>↻ <span>Refresh row <small>1 action</small></span></button>}
          {recycle && <div className="gv-recycle-row-controls">{ordering ? <button type="button" className="primary-button" onClick={recycle.onConfirm}>Recycle {deck} row · 1 action</button> : <button type="button" onClick={() => recycle.onDeck(deck)}>Choose {deck} row</button>}</div>}
        </div>})}
      </section>
      <aside className={`gv-reserve ${reserveInteraction ? 'is-choosing' : ''}`} aria-label="Shared piece reserve">
        <div className="gv-section-title"><h3>Shared supply</h3><span>Pieces by level</span></div>
        {reserveInteraction && <div className="reserve-exchange-cue" role="status">{reserveInteraction.source && <PieceGlyph id={reserveInteraction.source} />}<span>{reserveInteraction.label}</span>{reserveInteraction.onBack && <button type="button" onClick={reserveInteraction.onBack}>Back</button>}<button type="button" onClick={reserveInteraction.onCancel}>Cancel exchange</button></div>}
        <div className="gv-reserve-tray">{([1,2,3,4] as const).map(level => <div className="gv-reserve-level" key={level}><span className="gv-level-label">Level {level}</span><div>{PIECE_IDS.filter(id => PIECES[id].level === level).map(id => {
          const count = reserveInteraction?.counts[id] ?? reserve[id]
          const face = <><PieceGlyph id={id}/><span><span className="gv-sr-only">{PIECE_LABELS[id]}: </span>{count}</span></>
          return !reserveInteraction && id === 'single' && tableTools ? <button type="button" className="gv-reserve-piece gv-supply-take" key={id} disabled={!tableTools.canTakePiece} title="Add a Single to your pieces for 1 action" aria-label="Take a new piece for 1 action" onClick={tableTools.onTakePiece}>{face}<small>+ Take · 1 action</small></button> : reserveInteraction ? <button type="button" className={`gv-reserve-piece ${count === 0 ? 'is-empty' : ''}`} key={id} disabled={!reserveInteraction.choices.includes(id)} title={`${PIECE_LABELS[id]}: ${count} available`} aria-label={`Choose ${PIECE_LABELS[id]}, ${count} available, costs 1 action`} onClick={() => reserveInteraction.onChoose(id)}>{face}<small>{PIECE_LABELS[id]}</small></button> : <div className={`gv-reserve-piece ${count === 0 ? 'is-empty' : ''}`} key={id} title={`${PIECE_LABELS[id]}: ${count} available`}>{face}</div>
        })}</div></div>)}</div>
        <p className="gv-supply-help">Complete a puzzle to get <strong>all its pieces back + the reward.</strong></p>
      </aside>
      </div>
      {activePlayer ? <PlayerBoard key={activePlayer.id} player={activePlayer} active selectedId={effectiveSelected} onSelect={choose} onAction={onAction} canAct={canAct} viewerCanAct={viewerCanAct} visibleScores={visibleScores} finalScore={results?.find((result) => result.playerId === activePlayer.id)?.total} gameFinished={phase === 'scored'} masterMode={masterMode} finishingTouches={phase === 'finishing-touches'} stagedPuzzleIds={stagedPuzzleIds} onPiecePickup={onPiecePickup} onPlacementError={onPlacementError} viewerPlayerId={viewerPlayerId} tableTools={tableTools} actionsRemaining={phase === 'turns' ? actionsRemaining : 0} trayExchange={trayExchange} onCompleteStart={(puzzleId, from) => { pendingCompletion.current = { puzzleId, from, playerId: activeId } }}>{children}</PlayerBoard> : children && <div className="gv-results">{children}</div>}
    </div>
  </main>
}

export default GameView
