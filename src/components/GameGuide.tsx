import { useState } from 'react'

const GUIDE_KEY = 'project-l-guide-dismissed'
export function GameGuide({ hasPuzzle, hasPlacement, open, onClose, suspended }: { hasPuzzle: boolean; hasPlacement: boolean; open: boolean; onClose: () => void; suspended: boolean }) {
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(GUIDE_KEY) === 'yes' } catch { return false } })
  const dismiss = () => { setDismissed(true); onClose(); try { localStorage.setItem(GUIDE_KEY, 'yes') } catch { /* The guide also works without storage. */ } }
  const restore = () => { setDismissed(false); onClose(); try { localStorage.removeItem(GUIDE_KEY) } catch { /* Tips remain available for this session. */ } }
  return <div className={`game-guide ${(dismissed || suspended) && !open ? 'is-hidden' : ''}`}>
    {!dismissed && !suspended && !open && <div className="guide-nudge" role="status">
      <span><strong>{!hasPuzzle ? 'Take a tile from the market to begin.' : !hasPlacement ? 'Pick up a piece, then click or drop it into a puzzle.' : 'Fill a puzzle to get your pieces back, plus its reward.'}</strong> Three actions each turn.</span>
      <button type="button" aria-label="Dismiss first-turn guide" onClick={dismiss}>Got it</button>
    </div>}
    {open && <section id="game-rules" className="guide-rules" aria-label="How to play Project L">
      <div><strong>Build your tray. Complete puzzles. Earn points.</strong><button type="button" onClick={() => onClose()}>Close help</button></div>
      <ol><li>Take a market puzzle or draw face down. Keep up to 4 unfinished puzzles.</li><li>Click or drag a tray piece onto any of your puzzles. Rotate with R and flip with F, or use the buttons. For keyboard placement, Tab to a square, use arrows, then Enter or Space.</li><li>Complete a puzzle to recover its pieces, gain its pictured reward and score its points. This costs no extra action.</li></ol>
      <p>Each turn gives you 3 actions. Taking a puzzle, placing a piece, taking a Single from the shared supply, exchanging, refreshing a row and Master each cost 1 action. Click the yellow Single in the supply to take a new piece. Select one of your pieces and use Exchange to trade it for one of the same level, a lower level, or one level higher. Together these are the board game’s Upgrade action. Refresh row, beside each deck, is the Recycle action: return a market row to the bottom of its deck in your chosen order. The Master coin beside your turn marker places up to one piece per puzzle for 1 action total, once per turn.</p>
      <p>When the black deck runs out, finish this round and play one final round. Finishing Touches allow extra placements at −1 point per piece. Unfinished puzzles subtract their printed points.</p>
      <a className="guide-video" href="https://www.youtube.com/watch?v=hI0dlmXVqOc" target="_blank" rel="noreferrer">Watch the tutorial &amp; playthrough ↗</a>
      <button type="button" onClick={dismissed ? restore : dismiss}>{dismissed ? 'Show first-turn tips' : 'Hide first-turn tips'}</button>
    </section>}
  </div>
}
