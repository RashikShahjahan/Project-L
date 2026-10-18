# Project L interaction redesign — October 17, 2026

The design follows the physical game’s engine-building loop: take a puzzle, fill its recesses, recover the invested pieces, and add its reward to your personal supply. This is an implemented React interface, shared by the local and online game views.

## Gameplay references

- [Getting Games / JonGetsGames: Project L Tutorial & Playthrough](https://www.youtube.com/watch?v=hI0dlmXVqOc). Reviewed the exported English transcript. The video teaches through the first rounds: taking a puzzle at 2:16, placing at 2:59, recovering pieces and collecting a reward at 3:35, exchanging at 4:50, recycling at 6:32, and Master at 8:19. This recording uses an early edition; the existing version 2.5 rules specification and engine remain the implementation authority.
- [Project L Extended Playthrough](https://www.youtube.com/watch?v=6P6tnyVxKSk), linked directly from the tutorial. Found and verified its link; the full recording was not reviewed.
- [Meeple University: live playthrough](https://www.youtube.com/watch?v=aoLmgsbOaes), another footage option; base-game play starts at 6:10 and expansion play at 30:33. Discovered as a supplementary source, not used to establish rules.

## Decisions and implementation

| Physical behavior | Interface behavior |
| --- | --- |
| Shared market and personal player mat have distinct purposes | Desktop places the market and supply on the left, personal table on the right. Phone keeps an explicit market disclosure and collapses it after taking a puzzle. |
| Up to four puzzles sit in front of a player | Four visible spaces show the capacity. Empty spaces focus the market without spending an action. |
| A player picks up a piece and puts it in any puzzle | Every eligible puzzle accepts click/keyboard placement. Drag hit testing resolves the actual puzzle under the pointer instead of requiring it to be selected first. Preview is scoped to the hovered puzzle. |
| Completing a puzzle grows the engine | The first-turn strip shows take → fill → grow. Reward shapes are labeled on cards. The supply explains pieces back + reward. Existing automatic completion handling is retained. |
| Getting a new Single and exchanging an owned piece are different intentions | Separate Get a piece and Exchange a piece controls. An exchange starts in the real tray and ends in the actual shared supply. |
| Piece levels determine legal exchanges | Supply is grouped into levels 1–4, with the allowed replacement shapes highlighted during an exchange. |
| Master places one piece per puzzle | Visible action explanation, direct staging on each eligible puzzle, count/undo/commit controls. An unusable Master is disabled with an explanation; the legal empty action remains in a labeled disclosure. |
| Recycle changes a row of physical cards | Refresh market retains in-place drag ordering, arrow alternatives, and one confirmation next to the actual cards. |
| Three actions form a turn | Numbered remaining-action tokens and explicit costs. The active player's name and score stay near the workbench. |

Warm neutral surfaces, evergreen selection outlines, and brighter piece colors distinguish playable components without making core action names depend on icons. Keyboard controls, reduced-motion preferences, score privacy, and the existing game engine are retained.

## Verification

- TypeScript, Oxlint, production build, and all 57 existing tests pass. Socket tests required local network permission and passed on rerun with that permission.
- Browser verified: puzzle taking and replacement; piece selection and normal placement; completion/reward and turn advance; exchange from Domino to 3-corner; starting Recycle and its actual-card ordering controls; Master staging on two different puzzles and undo/cancel.
- Responsive checks at 1280 × 720 and 390 × 844. Phone puzzle cells measure 44 × 44 pixels; document width matches the viewport without horizontal overflow. The phone tray is sticky and scrolls internally if its controls exceed the height cap.
- This is an implementation and agent interaction check, not a human usability study. Cross-puzzle drag uses the corrected target lookup but was not exercised with an actual pointer drag. A full online browser session and endgame UI were not replayed in this pass; shared UI changes typecheck, and multiplayer/rules tests pass.

## Tabletop revision after user feedback

The first implementation above was rejected as still feeling like a form. Its boxed dashboard layout and four action cards have been replaced. The screen is now one warm table with eight slightly offset market tiles, loose personal puzzle tiles, acrylic-style pieces, physical action coins and a completed-card stack. There are no four empty placeholder cards or permanent action-card grid. Hints are short and contextual.

Actions attach to game objects: the yellow shared Single takes a new piece; Exchange is beside the selected personal piece; Refresh row sits beside each deck; Master is a coin beside the remaining-action coins. Market tiles now support pointer dragging onto the personal play area as well as clicking. Piece dragging includes a floating piece under the pointer. All puzzles continue to accept placements directly. On phones the piece rack stays accessible at the bottom and Market & supply explicitly names the disclosure.

Verification of this revision: actual pointer drag of market puzzle 12 onto the workbench; actual pointer drag of a Domino onto that puzzle; selected-piece exchange into a Domino; adding new Singles directly from the supply; Master coin entry, staging, undo and cancel; 390 × 844 phone layout and opening its exchange supply. All 57 engine/multiplayer tests pass; production build and lint pass. The online browser flow was not replayed, but local and online views both receive the shared object-action callbacks. Screenshots: [desktop](design/archive/ux-tabletop-desktop.jpg) and [mobile](design/archive/ux-tabletop-mobile.jpg).
