# Project L base-game rules specification

Tasks 1-2: document the rules and settle edge-case behavior before implementing the web app.

## Source and scope

Initial source: [user-provided English rulebook](/Users/rashik/Downloads/Project_L.Rules.en.pdf), base-game pages 4-7. Both the text and diagrams were reviewed.

Clarification source: [Boardcubator's Rulebook 2.5](https://drive.google.com/file/d/1ohB7wQ3MtwkyQrXXVjFBF4iVWakPLTjC/view), linked from the [publisher's resources page](https://www.boardcubator.com/resources/), reviewed on 2026-10-12. Printed pages match PDF pages. Its page 6 reserve-shortage rules supersede the ambiguous shortage notes in the supplied book; the other base-game action, completion, endgame, and scoring rules were checked against pages 6-7. Page references below apply to both books unless version 2.5 is specified.

The initial implementation targets the base game for 2-4 players, using the version 2.5 reserve clarification. The optional visible-score variant is included as a configuration option. Solo play, Line Clear, Ghost Piece, Ambassador Pack, Finesse, Phoenix, and Endless White Deck are separate future modes; their rules must not leak into the base game.

Sections labeled **Implementation interpretation** distinguish chosen software behavior from explicit publisher rules. Section 11 records the seven edge-case decisions and their evidence status. These decisions settle behavior for this implementation; they do not claim publisher confirmation where the book remains silent. This document describes the game; it does not implement it.

## 1. Components and terminology

Sources: pages 4-5.

- 32 white puzzles and 20 black puzzles in the base-game collection.
- 135 pieces: 15 copies of each of nine shapes.
- Each puzzle has a fillable recessed shape, a point value, and a specific reward piece.
- The **reserve** is the shared pool of unowned pieces.
- A player's **personal supply** contains their available, unplaced pieces.
- **Unfinished puzzles** are the player's active puzzles, including their placed pieces.
- **Completed puzzles** go into that player's victory-point pile.

The piece diagram on page 5 establishes these shapes. The identifiers and grid notation below are implementation names, not printed component names. `#` denotes an occupied square; `/` separates rows. Reflections and rotations are allowed during placement.

| Proposed ID | Level / area | Shape | Canonical grid | Initial reserve |
| --- | --- | --- | --- | --- |
| `single` | 1 | Single square | `#` | 15 |
| `domino` | 2 | Two-square bar | `##` | 15 |
| `tri-line` | 3 | Three-square bar | `###` | 15 |
| `tri-corner` | 3 | Three-square corner | `#./##` | 15 |
| `tet-t` | 4 | T | `###/.#.` | 15 |
| `tet-line` | 4 | Four-square bar | `####` | 15 |
| `tet-l` | 4 | L | `#./#./##` | 15 |
| `tet-zigzag` | 4 | Zigzag | `.##/##.` | 15 |
| `tet-square` | 4 | Square | `##/##` | 15 |

Because pieces can be flipped, mirrored L and zigzag forms are orientations of the same type, not extra reserve types. Physical mats, markers, and the bag do not add base-game engine resources; the first-player marker determines who starts.

## 2. Setup

Sources: pages 4-5.

1. Shuffle all 32 white puzzles into a face-down deck.
2. Randomly select black puzzles from the 20-puzzle collection, then shuffle the selected set:

   | Players | Black puzzles selected | Black puzzles left in deck after reveal |
   | --- | --- | --- |
   | 2 | 12 | 8 |
   | 3 | 14 | 10 |
   | 4 | 16 | 12 |

3. Reveal four puzzles from each deck into a white market row and a black market row. These eight puzzles are part of the selected sets, not additional puzzles.
4. Put all pieces into the shared reserve.
5. Randomly assign the first-player mat among the players. This selects the first player; subsequent turns proceed clockwise.
6. Give each player one level-1 piece and one level-2 piece from the reserve.
7. Each player begins with no unfinished puzzles and no completed puzzles.

**Implementation interpretation:** represent clockwise seating as a fixed ordered list. Use seeded randomization for reproducible setup and replays. At setup, subtract the starting pieces from the reserve: `single = 15 - playerCount`, `domino = 15 - playerCount`; each other type remains at 15.

## 3. Rounds and turns

Source: page 6.

- A round gives every player one turn, beginning with the same first player.
- Each turn requires exactly three actions.
- Actions can be taken in any order and repeated, except Master, which is limited to once per turn.
- Completing a puzzle does not consume an extra action or end the turn.
- Pieces returned and rewards gained after an action can be used in later actions of that turn.
- Reset the action count and Master-used flag at the start of each turn.

There is no explicit Pass action in the base-game rules. Do not add a general early-end-turn option as if it were an official rule. Under the chosen interpretation, an empty Master spends one action and uses the turn's Master allowance; see section 4.

## 4. The five actions

Source: page 6. Every action below costs one of the three actions.

### Take

- The player must have fewer than four unfinished puzzles.
- Choose either one visible puzzle from either market row, or the top face-down puzzle from either deck.
- Add the selected puzzle to the player's unfinished puzzles, face up.
- When taking a visible puzzle, replace its market slot from the corresponding deck, subject to the endgame rules.
- A direct deck draw is a committed choice made without inspecting the puzzle first. It does not remove a market puzzle.
- Taking a puzzle is not a placement action and does not include placing a piece.

**Implementation interpretation:** an empty deck cannot be drawn from; an empty market slot cannot be selected. If a white deck has run out, taking a remaining visible white puzzle leaves an empty slot because there is no replacement. White exhaustion does not trigger the endgame, replenish from completed puzzles, or prevent taking the remaining white market puzzles. The rulebook does not describe white-deck exhaustion separately.

### Recycle

- Choose the white row or the black row.
- Put every puzzle currently in that row at the bottom of its matching deck, in an order chosen by the active player.
- Reveal four puzzles from the top of that deck to refill the row.
- Do not shuffle the deck during this action.

**Implementation interpretation:** specify the bottom order as earliest-to-latest future draw, then reveal up to four puzzles into slots from left to right. If the deck and row together contain fewer than four puzzles, reveal all of them and keep the remaining slots empty. Existing empty slots are not puzzle IDs and are omitted from the bottom-order selection.

Recycle remains legal after the endgame trigger, including on the black row. The ban on replacing a black puzzle applies to Take, not Recycle. With an empty black deck, Recycle returns the remaining row puzzles to the deck and reveals those same puzzles again; it creates no new puzzles and leaves the deck empty. The endgame schedule and the turn's black-Take counter stay unchanged. Recycling an empty row is allowed and spends an action even if it reveals nothing. These are project interpretations of an unrestricted Recycle action, not an explicit publisher ruling on these cases.

### Upgrade

Choose one of two alternatives:

1. Acquire a new level-1 piece from the reserve, adding it to personal supply.
2. Return one unplaced piece from personal supply to the reserve and take one replacement piece.

For an exchange, the replacement may be any shape at the same level, any lower level, or one level higher. A level-4 piece cannot normally upgrade to level 5 in the base game.

Use the common reserve-shortage procedure below for either alternative. One missing preferred shape does not permit jumping to another level when another shape at the requested level remains.

Placed pieces are not in personal supply and cannot be exchanged. The reserve is finite; acquiring pieces must respect its counts. Returning the surrendered piece happens before acquiring the replacement, as specified by the rulebook.

### Reserve shortages (version 2.5, page 6)

For Upgrade, first select the normally permitted requested type; for a completion reward, the puzzle supplies that type.

1. If that type is available, take it.
2. Otherwise, if any type at its level is available, choose one of those types.
3. Only when that entire level is empty, choose an available piece one level higher or at any lower level. The book's example permits continuing upward through consecutive empty levels.

**Implementation interpretation:** make step 3 precise by offering all available lower-level types plus all types at the first nonempty higher level. The player chooses among these candidates; do not automatically prefer a downgrade or an upgrade. Search stops at level 4 in the base game. There is no level 5, wraparound search, or creation of additional pieces. Inspect the reserve after returning the surrendered piece in an exchange; even the returned piece can be a legal fallback.

If the entire reserve is empty, acquiring a new piece with Upgrade is invalid and spends no action. A completed puzzle still returns its placed pieces and enters the completed pile, but grants no reward and creates no deferred entitlement. This no-reward behavior is a project policy for a case neither book specifies. Returning puzzle pieces adds them to personal supply, not the reserve, so it does not fix a reserve shortage. An exchange always leaves at least its surrendered piece available for fallback.

### Place

- Choose one piece in personal supply and one unfinished puzzle owned by that player.
- Rotate or flip the piece as desired, then place it flat within the puzzle's recessed region.
- Every occupied square of the piece must be within the fillable region.
- It must not overlap any piece already there.
- Remove the placed piece from personal supply.
- Once placed, a piece cannot be repositioned or removed until the puzzle is completed.

**Implementation interpretation:** model puzzles and pieces as sets of square-grid cells. Legal placements are orthogonal rotations and reflected orientations translated onto that grid; deduplicate equivalent orientations. Previewing a placement is free. Committing a legal placement spends an action. Invalid placement attempts do not change game state or spend an action.

### Master

- At most once per turn.
- Place at most one piece from personal supply into each of the player's unfinished puzzles.
- The player may skip any puzzle.
- Every placement must follow the Place rules.
- This whole collection of placements consumes one action.

**Important timing:** completion happens at the end of an action. Consequently, commit all Master placements before returning pieces or giving rewards for any puzzle completed by Master. A piece used in one placement cannot be reused on another puzzle within that Master action. Newly earned reward pieces also cannot be used within the same Master action.

**Implementation interpretation:** represent Master as one atomic batch of zero to four placements, with distinct puzzle targets and sufficient piece counts for the entire batch. An empty batch is legal even with no unfinished puzzles; it spends one action and marks Master used. This follows the permission to skip every puzzle, but the empty case is not expressly discussed in the rulebook.

## 5. Puzzle completion

Source: page 6.

A puzzle is complete when its entire recessed area is filled. Check for completion at the end of each action. Master can complete more than one puzzle in a single action.

For each completed puzzle, perform these steps in order:

1. Return every piece placed in that puzzle to its owner's personal supply.
2. Take the exact reward piece shown on the puzzle from the reserve, adding it to personal supply.
3. Move the puzzle to the owner's completed-puzzle pile, normally face down.

If the depicted reward type is unavailable, use the common version 2.5 reserve-shortage procedure in section 4. In particular, an available same-level alternative takes precedence over moving to another level. This replaces the supplied book's older reward-shortage note.

The completed puzzle frees an unfinished-puzzle slot. Its returned pieces and reward are available before the player's next action. The puzzle is scored at game end; it does not return to a deck or market.

**Implementation interpretation:** the active player chooses the resolution order for puzzles completed together, then chooses any fallback reward as each puzzle resolves against the current reserve. Validate the order as a permutation of exactly the completed puzzle IDs. Fully resolve one puzzle before the next. Pause further actions until all completions and reward choices finish; these choices cost no extra action. Record both order and rewards in the replay. Neither book specifies who chooses this order, so this is a project policy, not an official clarification. All Master placements are already committed before resolution begins.

## 6. Endgame trigger and final round

Source: page 6.

- Trigger the endgame when the black **draw deck** becomes empty. Black puzzles may still remain in the market or with players.
- Complete the current round, then play one additional full round.
- If the deck empties during the last player's turn, finish that turn and then play the additional round.
- If it empties during an earlier player's turn, that player finishes their three actions, the remaining players finish the current round, and then everybody gets one final turn.
- All players finish with an equal number of turns.

As soon as the endgame is triggered:

- Visible black puzzles taken afterward are not replaced.
- Each player may take at most one black puzzle per turn from that point onward.
- This restriction applies immediately to the player whose action triggered the endgame.
- Black puzzles acquired before the trigger do not count toward this new limit.
- White acquisitions remain subject to the four-unfinished-puzzle cap but have no new per-turn limit.

**Implementation interpretation:** track the trigger round and final round (`triggerRound + 1`), and latch the trigger permanently. Returning puzzles to a deck cannot reset or delay the ending.

For a black Take, classify its acquisition using the trigger state when the action starts:

1. If already triggered, require a zero black-Take counter, acquire the puzzle, increment that counter, and leave its market slot empty. No black deck draw is available in a reachable post-trigger base-game state.
2. Otherwise, acquire the selected puzzle, then refill its slot if it was a market Take. A blind draw leaves the market unchanged. If removing the last black deck puzzle during either operation empties the deck, latch the trigger immediately, before another action is accepted.
3. The triggering Take does not increment the new counter. Its acquisition belongs to the pre-trigger action, including a blind draw of the last deck puzzle. The triggering player may therefore Take one more black puzzle that turn if they have an action and an unfinished-puzzle slot remaining.

This event order is a project interpretation of the exclusion for acquisitions before the trigger, not an explicit ruling on the last blind draw. In reachable pre-trigger base-game states, the black row contains four puzzles: Recycle returns four and reveals four, preserving the positive deck count, so it cannot first trigger the endgame. Reset the counter at the start of every turn; keep it unchanged through Recycle.

Example: In a three-player game with seating A, B, C, if B empties the black deck during round 5, B finishes their turn and C plays. A, B, and C then play round 6; normal turns stop after C.

## 7. Finishing Touches

Source: page 7.

After the final round, each player may make any number of additional legal placements using pieces from personal supply into their unfinished puzzles.

- Finishing Touches are optional and have no three-action limit.
- Each additional **piece** placed deducts one point from that player's final score, regardless of the piece's level or area.
- Complete all of a player's Finishing Touches placements before processing any newly filled puzzle.
- Do not return pieces from a newly filled puzzle while the player is still choosing more Finishing Touches. They cannot reuse those pieces to complete another puzzle during this phase.
- Puzzles completed during Finishing Touches grant their printed points but no reward piece.

**Implementation interpretation:** offer a placement batch followed by a Finish confirmation, including an empty batch. On confirmation, resolve all completed puzzles, returning their placed pieces under the normal completion step, but skip reward acquisition. This preserves delayed completion and prevents piece reuse during the batch. Returning pieces after commitment applies the normal completion rule; the book does not restate that return step for Finishing Touches. Committed players cannot place more pieces. Score only after every player has committed and all resulting completions have resolved.

A puzzle still unfinished after this phase incurs its full printed point-value penalty. It does not score proportionally to the area filled.

## 8. Scoring and winners

Source: page 7.

For each player:

```text
finalScore = sum(points on all completed puzzles)
           - sum(points on all remaining unfinished puzzles)
           - number of pieces placed during Finishing Touches
```

Do not clamp negative scores to zero; the rules specify subtraction without a lower bound.

Rank players using these criteria in order:

1. Highest final score.
2. Most completed puzzles, including those completed during Finishing Touches.
3. Most pieces leftover.
4. If still tied, share the victory.

**Implementation interpretation:** count individual pieces in personal supply after all Finishing Touches completions resolve, including pieces returned from those completed puzzles. Exclude pieces trapped in unfinished puzzles. Each piece counts once regardless of its level or area. The book does not define leftover pieces precisely, so this is a project scoring policy, not publisher-confirmed wording.

Rulebook example: page 7 shows completed puzzles worth 24 total points after Finishing Touches, no unfinished puzzles, and three Finishing Touches placements. The final score is `24 - 0 - 3 = 21`.

Additional arithmetic check: completed puzzles worth 12 points, one unfinished 4-point puzzle, and two Finishing Touches placements produce `12 - 4 - 2 = 6`.

## 9. Public information and optional visible scores

Sources: pages 4-6.

- Face-up market puzzles, unfinished puzzles, and personal piece supplies are visible.
- The face-down puzzle decks must not be previewed before drawing.
- Completed puzzles are placed face down by default.
- The optional Known Victory Points variant keeps completed puzzles face up so everyone can see scores. Players agree to this option before setup.

**Implementation interpretation:** store deck contents internally while exposing only deck counts to player observations. Make completed-pile visibility configurable; suppress the opponent's current score display in the default mode. Players may remember previously seen public puzzles.

## 10. Required state and engine invariants

These are implementation requirements derived from the rules, not additional game rules.

Minimum shared state:

- Player order, first player, active player, round number, actions remaining.
- Phase: normal turns, Finishing Touches, or scored.
- White and black deck orders, market slots, and excluded black puzzles.
- Reserve counts by the nine piece types.
- Whether endgame has triggered, trigger round, and final round.
- Per-turn Master usage and black acquisitions counted after the trigger.
- Pending completion IDs and their chosen resolution order; reward selection must finish before the next action.
- Score-visibility setting and seeded random state for replay.

Minimum player state:

- Piece counts in personal supply.
- Up to four unfinished puzzles, each with its placements.
- Completed puzzle IDs.
- Finishing Touches placement count and commitment status.

Required invariants:

- For every piece type: reserve + all personal supplies + all pieces placed in puzzles = 15.
- No negative reserve or supply counts.
- Every selected puzzle is in exactly one place: draw deck, market, a player's unfinished area, or their completed pile.
- Excluded black puzzles are tracked separately and cannot enter play.
- No unfinished-puzzle count above four.
- All placements occupy fillable cells with no overlap.
- Normal actions cost exactly one action; completing puzzles costs none.
- Master uses distinct puzzle targets and can occur no more than once per turn.
- Completion, reward choices, and automatic transitions finish before another normal action begins.
- All players receive the same total number of normal turns before Finishing Touches.
- Once scored, no further actions are accepted.
- Endgame trigger and final round never reset; post-trigger black Take never refills its market slot.
- Before the endgame trigger, the black market has four puzzles; afterward, the black deck is empty between actions.
- Shortage resolution never creates pieces, and unavailable new-piece acquisitions do not consume an action.
- Finishing Touches commitments are final, and leftover-piece counts are taken only after all completions resolve.

## 11. Edge-case decisions and missing content

All seven ambiguity items have a defined implementation behavior as of 2026-10-12. Publisher evidence and project decisions are distinguished below. A later publisher clarification can replace a policy through an explicit specification change; do not silently mix rulebook editions.

| Item | Chosen behavior | Evidence status |
| --- | --- | --- |
| Reserve shortage fallback | Same-level alternatives first; if that level is empty, choose any lower level or the first nonempty higher level. Stop at level 4. Empty reserve blocks new-piece Upgrade and gives no completion reward. | Version 2.5 p. 6 clarifies same-level substitution and lower/higher fallback. The exact candidate search and empty-reserve behavior are implementation interpretations. |
| Simultaneous completion order | Active player orders completions and chooses rewards sequentially; no further action during resolution. | Project policy; both books p. 6 permit simultaneous completion but do not assign its order. |
| Triggering black acquisition | Triggering Take is uncounted for both market refill and blind draw; one subsequent black Take is permitted that turn. Recycle does not count as an acquisition. | Project event-order interpretation of the endgame wording, supplied p. 6 and version 2.5 pp. 6-7. |
| Post-trigger black Recycle | Legal, revealing up to four returned puzzles; no change to ending or acquisition counter. Empty-row Recycle still spends an action. | Project interpretation of unrestricted Recycle, p. 6. |
| Leftover pieces | Count supply pieces after Finishing Touches completion returns; exclude unfinished placements and count pieces rather than area. | Project policy; p. 7 leaves the term and precise counting instant undefined. |
| Zero-placement Master | Legal with any number of unfinished puzzles, including zero; consumes one action and the once-per-turn allowance. | Literal implementation interpretation of skipping puzzles, p. 6; empty Master is not expressly discussed. |
| Exhausted white market | Take leaves a vacancy; Recycle reveals as many as remain. No white-exhaustion endgame or completed-puzzle recycling. | Project interpretation of finite decks and the black-only endgame trigger, p. 6. |

### Completed content task: the puzzle catalog

The exact cell masks, points, and rewards for all 32 white and 20 black physical puzzles are encoded in [data/base-game-puzzles.json](../../data/base-game-puzzles.json). The source is Boardcubator's official [Puzzle List, updated 2023](https://drive.google.com/file/d/10-10J5Cs584eoKPhg_AaXMjE43Znmi8F/view), base-game panel only. All 52 entries were validated against the publisher PDF on 2026-10-12; see [puzzle-catalog.md](puzzle-catalog.md) for source provenance, schema, reproduction, and duplicate handling. Puzzles 22 and 23 are identical designs retained as separate physical IDs.

The nine base-game piece shapes can be modeled from the page 5 diagram. The catalog is publisher-derived rather than synthetic. Any additional prototype fixtures must still be explicitly labeled synthetic and kept out of the base-game decks.

## 12. Acceptance cases for the rules engine

The engine behaviors below are covered by the automated suite in `tests/engine-acceptance.test.ts`; catalog and setup checks remain in `tests/game-model.test.ts`. The player-observation privacy case is deferred until an observation API is introduced.

- Two-player setup has four white and four black market puzzles, 28 white and 8 black deck puzzles, and two starting pieces per player.
- A player at four unfinished puzzles cannot Take; completing one frees a slot for a later action.
- A blind draw reveals its puzzle only after commitment and leaves the visible market unchanged.
- Recycle preserves the selected bottom order and does not reshuffle the deck.
- Upgrade exchanges only personal-supply pieces; changing shape at the same level and downgrading are valid.
- An unavailable single shape does not permit a higher-level Upgrade fallback if another shape at the desired level remains.
- Missing `tri-line` rewards offer `tri-corner` when it remains; they do not offer level 4 while level 3 has stock.
- With level 3 empty and level 4 stocked, a requested level-3 acquisition offers stocked level-1, level-2, and level-4 types. The player chooses; lower levels are not forced.
- With levels 1-2 empty, a new-piece Upgrade offers level-3 types if any remain; it reaches level 4 only if level 3 is also empty.
- With level 4 empty, a level-4 reward offers stocked lower levels and never invents a level-5 piece.
- With the reserve empty, new-piece Upgrade is rejected without state changes; completion returns pieces to personal supply and scores the puzzle without a reward or reward debt.
- Exchange fallback observes the reserve after the surrendered piece returns and preserves counts even if that piece is the only candidate.
- A reflected placement is legal if it fits; outside cells, overlaps, and moving committed pieces are invalid.
- A normal completion returns placed pieces, grants the reward, and frees the puzzle slot before the next action.
- Master cannot place twice into one puzzle, run twice in one turn, or reuse a piece returned by a completion within that same action.
- Empty Master with zero or several unfinished puzzles spends one action, marks Master used, and changes no pieces or puzzles.
- Simultaneous completion accepts only a complete, duplicate-free permutation of completed IDs. Each reward sees the reserve after earlier rewards; pending choices prevent another normal action.
- Black-deck exhaustion during either an early or late player's turn yields equal total turns and exactly one additional full round.
- A market Take with one black deck puzzle left acquires the market puzzle, reveals that last deck puzzle, and triggers with a zero black-Take counter. One more black Take is legal if action and puzzle capacity remain; it leaves a vacancy and increments the counter to one. A further Take that turn is invalid.
- A blind draw of the last black deck puzzle triggers with the same zero counter but leaves the market unchanged; one subsequent black Take is permitted under the same capacity conditions.
- A black Recycle with one deck puzzle and four market puzzles before the trigger returns the four, reveals four, and leaves one in the deck without triggering. With an empty deck after the trigger, recycling three market puzzles reveals only those three and preserves the ending and counter.
- At the next turn, the black-Take counter resets to zero while the trigger stays latched.
- Empty white deck prevents blind white draws; visible white Take leaves a vacancy. Recycling two white puzzles with an empty deck reveals those same two, leaves two vacancies, and does not trigger the endgame.
- Recycling an empty row with an empty matching deck consumes an action with no puzzle changes, including when other actions are unavailable.
- Finishing Touches cannot reuse pieces from puzzles filled earlier in that same batch and grants no reward pieces.
- Score calculation reproduces the page 7 result of 21, subtracts full unfinished values, and allows negative totals.
- Finishing Touches completion returns pieces only after commitment, counts them as leftover supply, and grants no reward. A player cannot place again after commitment; scoring waits for all players.
- Equal scores use completed-puzzle count, then individual supply-piece count after all Finishing Touches completions, then a shared victory. Pieces trapped in unfinished puzzles do not break a tie; a level-4 piece and a level-1 piece each count as one.
- Hidden deck order is absent from player observations; the visible-score option is fixed before play. Observation privacy is not yet testable because the engine currently exposes only authoritative state and has no player-observation API.
- Every accepted transition preserves piece and puzzle conservation.
