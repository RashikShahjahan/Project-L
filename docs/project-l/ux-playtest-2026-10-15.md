# Project L UX play-test — October 15, 2026

Implementation follow-up, October 16: shared local/online controls now exchange through the tray and reserve, reorder actual market cards with pointer drag and accessible arrows, skip completion prompts with no choice, keep action labels/costs visible, and provide first-turn tips and rules help. Empty Master remains legal as a direct “Spend Master” action rather than entering unusable staging. Desktop and phone layouts, local Master staging/undo, local/online automatic rewards, and online turn synchronization were checked in the browser. All 57 automated tests pass, including five new completion-boundary cases. The original observations below describe the pre-change UI.

Three GPT-6 Luna agents played separate local games through the browser. Coverage included taking puzzles, selecting and placing pieces, turn changes, Upgrade, Recycle, Master staging, and completion rewards. The lead agent independently reproduced Upgrade → Exchange at a 1280 × 720 viewport and checked relevant implementation paths. This is an agent usability audit, not a human user study. Mobile, online play, finishing touches, and a full game to final scoring were not covered.

The central finding: the board already supports direct placement, but auxiliary actions repeatedly move the player into a distant selection-and-confirmation panel. The resulting interaction feels procedural even though the tabletop visuals are coherent.

**1. High priority — Upgrade duplicates the physical pieces into a form.**

Observed: open Upgrade → Exchange a piece. The panel asks for a trade-in piece, a requested shape, and a separate Make exchange confirmation. The source pieces duplicate the existing tray, and the requested pieces duplicate the reserve concept. For taking a new Single, the flow still displays “Choose a piece to add” even when there is only one candidate, followed by a separate submit button.

Proposed change: offer a clearly labeled “Take Single · 1 action” shortcut when there is exactly one legal result. Start an exchange from a tray piece, reveal eligible reserve pieces nearby, and show a compact source → result preview. Preserve explicit choice for reserve fallback cases. Keep click/keyboard alternatives to any drag gesture.

Implementation reference: `src/App.tsx:206–209`.

**2. High priority — Expanded controls push decisions below the viewport.**

Observed: at 1280 × 720, Upgrade → Exchange grows the lower-right panel beyond the visible area; requested pieces and confirmation fall below the viewport. The Recycle ordering stage has the same problem. The tray also gains large empty areas alongside the tall panel. Players must scroll away from the board and market to complete actions.

Proposed change: keep the action preview and commit/cancel controls together in a compact, consistently positioned area. Place reserve-related controls beside the tray and recycling controls beside the market. Avoid increasing the height of the whole tray for one action.

Evidence: [Exchange panel at 1280 × 720](design/archive/ux-audit-exchange.png).

Implementation references: `src/components/Tabletop.css:238–243`, `src/App.css:37–49`.

**3. High priority — Completing one puzzle asks for a meaningless ordering decision.**

Observed: fill a single puzzle. The market becomes unavailable, and the controls show Choose completion order, one puzzle, disabled earlier/later buttons, and Confirm order. Only after confirming does the reward choice appear. This adds a mandatory step with no possible decision.

Proposed change: automatically resolve the ordering step for a single completed puzzle. If a reward also has exactly one legal result, resolve it automatically with a visible reward animation/message. Preserve ordering and reward choices whenever there is a real choice, including multiple simultaneous completions and reserve substitutions.

Implementation references: `src/game/engine.ts:102–110`, `src/App.tsx:213–214`.

**4. Medium priority — Recycle replaces the market with a separate ordering worksheet.**

Observed: Recycle → Black puzzle row opens four miniature puzzle entries, each with Move earlier/later buttons, followed by Return row and reveal next. The real market remains visible elsewhere but disabled. Reordering is detached from the cards being returned.

Proposed change: enter recycle mode on the actual market row. Display the return order on those cards, allow drag or accessible move controls in place, and keep one nearby “Recycle row · 1 action” confirmation. Keep a valid default order so unchanged order needs no extra interaction.

Implementation reference: `src/App.tsx:210`.

**5. Medium priority — Master can enter a state where no move is possible.**

Observed: with no available pieces or no eligible workbench puzzles, clicking Master still enters staging mode. The market and other actions become unavailable; the staged count is zero and Play Master is disabled. Cancel is the only useful action. With a usable piece and puzzle, staging and committing did work.

Proposed change: prevent entry when no legal placement exists and explain why next to the action. When usable, mark eligible puzzles and show a persistent staged-count/commit control near the workbench. Retain the deliberate final commit: it is valuable for a multi-puzzle action.

Implementation references: `src/App.tsx:205,211`, `src/components/GameView.tsx:93–97`.

**6. Medium priority — Primary action names are hidden on desktop.**

Observed: Upgrade, Recycle, and Master appear as three small gold icons at rest. Their names and costs appear on hover/focus. A new player must inspect each icon to learn core actions; the sparkle symbol does not explain Master.

Proposed change: keep short action labels visible with compact cost badges. Describe Master as “One piece per puzzle · 1 action” when first used. Preserve accessible names and keyboard focus treatment.

Implementation reference: `src/components/Tabletop.css:200–215`.

**7. Medium priority — The first turn does not explain the piece economy.**

Observed: the initial instruction is “Take a puzzle from the market.” One agent took puzzle #12, placed a Single and Domino, spent all three actions, and returned on the next turn with the puzzle one square short and no pieces. “Upgrade to get a piece” provides recovery, but the relationship between action costs, locked pieces, completion, and replenishment has not been explained. No help entry was found in the game menu.

Proposed change: add a brief, dismissible first-turn guide tied to the real board: take a puzzle, place a piece, and explain that completing a puzzle returns its pieces and earns a reward. Make the action cost visible before each action and provide an obvious rules/help entry.

**Recommended implementation order:** remove no-choice completion steps and the redundant Single flow; make labels persistent; prevent unusable Master entry; then redesign Upgrade and Recycle around the existing tray, reserve, and market. Preserve current click placement, drag support, legal/invalid previews, and keyboard navigation while improving their discoverability.

**Evidence boundaries:** direct dragging and preview classes already exist in `GameView.tsx`; this audit does not claim they are absent. Source inspection shows drag hit-testing is restricted to the selected puzzle, but cross-puzzle dragging was not verified in the browser. One agent initially mistook an automatic turn change for puzzle completion; that claim was corrected. A suggested keyboard-order issue was excluded because the test began after clicking late in the document and did not establish a defect.

No gameplay source files were changed during this audit.
