import { useState } from 'react'
import { dismissTutorial, setTutorialAutoDisabled, tutorialAutoDisabled } from './tutorial.js'
import './GameGuide.css'

const STEPS = [
  { label: 'The goal', title: 'Complete puzzles. Earn points.', text: 'Complete puzzles to earn their printed points and grow your collection of pieces. Most points wins. Each turn gives you 3 actions.', hint: 'Everyone starts with a Single and a Domino. White puzzles help you build; black puzzles offer more points.' },
  { label: 'Take a puzzle', title: 'Take a puzzle from this market.', text: 'Spend 1 action to take a face-up market puzzle or draw a blind puzzle from either deck. You may keep up to 4 unfinished puzzles.', hint: 'The market refills after you take a face-up puzzle. Start with a small puzzle your pieces can fill.' },
  { label: 'Place a piece', title: 'Place a piece on your workbench.', text: 'Spend 1 action to place one of your unused pieces on a puzzle. Rotate or flip before placing. Every square must fit inside the puzzle with no overlap.', hint: 'A preview shows whether a placement is legal. Once placed, a piece stays fixed until that puzzle is complete.' },
  { label: 'Complete a puzzle', title: 'Fill a puzzle to collect its reward.', text: 'Fill every square to complete the puzzle. Recover all its pieces, gain its pictured reward and score its printed points. Completion costs no extra action.', hint: 'Recovered pieces and rewards are available for later actions in the same turn.' },
  { label: 'Grow your pieces', title: 'Take a Single, or make an exchange.', text: 'Spend 1 action to take a new Single from the shared supply OR exchange one unused piece for a piece of the same level, a lower level, or one level higher.', hint: 'Level means the number of squares in a piece. You cannot exchange a piece already on a puzzle. Choices depend on the shared supply. If a requested shape is out, the game offers available alternatives.' },
  { label: 'Refresh a row', title: 'Refresh a row beside either deck.', text: 'Spend 1 action to refresh a white or black market row. Return that row to the bottom of its deck in your chosen order, then reveal up to four new puzzles.', hint: 'Use Refresh row beside a deck. Arrange the cards before confirming. A nearly empty deck may reveal fewer than four cards.' },
  { label: 'Master action', title: 'One action. Several puzzles.', text: 'Once per turn, spend 1 action total to place up to one piece on each of your unfinished puzzles. Choose placements, then confirm the batch.', hint: 'Completions resolve only after the whole Master batch. Pieces and rewards from those completions cannot be reused within that batch.' },
  { label: 'Ending & scoring', title: 'Watch the black deck and your score.', text: 'When the black deck empties, finish the current round and play one final round. Then each player may make optional Finishing Touches placements at −1 point per piece.', hint: 'After the ending triggers, each player may take at most one more black puzzle per turn; black market cards taken are not replaced. Finishing Touches give no reward pieces. Subtract unfinished printed points and finishing penalties from completed points.' },
] as const

interface GameGuideProps {
  open: boolean
  step: number
  onStep: (step: number) => void
  onClose: () => void
  onShowTarget: () => void
  gameId: string
  playerId: string
  turnStatus: string
  canAct: boolean
  canPlace: boolean
  canTake: boolean
  collapsed: boolean
  onCollapse: () => void
  hasPuzzle: boolean
  phase: 'turns' | 'finishing-touches' | 'scored'
}

export function GameGuide({ open, step, onStep, onClose, onShowTarget, gameId, playerId, turnStatus, canAct, canPlace, canTake, collapsed, onCollapse, hasPuzzle, phase }: GameGuideProps) {
  const [autoDisabled, setAutoDisabled] = useState(tutorialAutoDisabled)
  if (!open) return null
  const content = STEPS[step]
  const close = () => { dismissTutorial(gameId, playerId); onClose() }
  const context = phase === 'scored' ? 'The game is complete. Inspect the highlighted parts of the table or browse any rule.'
    : phase === 'finishing-touches' ? 'The market is closed. You can inspect the table; finishing placements use the controls on your workbench.'
    : !canAct ? 'Wait or inspect the highlighted area. You can browse every rule without taking a move.'
    : step === 1 ? !canTake ? 'Taking a puzzle is currently unavailable. Finish your current choice or free a workbench space; Next is always available.' : 'Choose a real market tile or deck. Taking a puzzle here moves the guide to placing.'
    : step === 2 ? !hasPuzzle ? 'Take a puzzle first when you are ready, or continue reading with Next.' : !canPlace ? 'Finish the current choice using your turn controls, then choose a piece to place.' : 'Choose a real tray piece and preview it on a puzzle. A confirmed placement moves the guide forward.'
    : step === 3 ? 'Continue filling your puzzles at your own pace. A completed puzzle moves the guide forward; Next is always available.'
    : 'Use the highlighted controls when you are ready, or keep reading. Every move you choose affects this game.'
  return <section className={`game-coach ${collapsed ? 'is-collapsed' : ''}`} id="game-rules" aria-label="How to play on your table">
    <header className="coach-header"><div><span>HOW TO PLAY · {step + 1} / 8</span><h2>{content.title}</h2></div><div><button type="button" aria-expanded={!collapsed} aria-controls="coach-details" onClick={onCollapse}>{collapsed ? 'Expand guide' : 'Collapse'}</button><button type="button" onClick={close}>Skip tutorial</button></div></header>
    <p className="coach-live" role="status">{turnStatus}</p>
    {!collapsed && <div id="coach-details"><nav className="coach-steps" aria-label="Tutorial steps">{STEPS.map((item, index) => <button type="button" key={item.label} aria-label={`Step ${index + 1}: ${item.label}`} aria-current={index === step ? 'step' : undefined} onClick={() => onStep(index)}>{index + 1}<span>{item.label}</span></button>)}</nav><div className="coach-copy" aria-live="polite"><p>{content.text}</p><p className="coach-hint">{content.hint}{step === 7 && ' Example: 12 completed points − 4 unfinished points − 2 finishing pieces = 6 points.'}</p><p className="coach-context">{context}</p></div></div>}
    <footer className="coach-footer"><div className="coach-navigation"><button type="button" disabled={step === 0} onClick={() => onStep(step - 1)}>Back</button><button type="button" onClick={onShowTarget}>Show on board ↓</button>{step < 7 ? <button type="button" className="coach-next" onClick={() => onStep(step + 1)}>Next →</button> : <button type="button" className="coach-next" onClick={close}>Ready to play</button>}</div>{!collapsed && <label><input type="checkbox" checked={autoDisabled} onChange={(event) => { setAutoDisabled(event.target.checked); setTutorialAutoDisabled(event.target.checked) }} />Don’t show automatically next game</label>}</footer>
  </section>
}
