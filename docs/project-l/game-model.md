# Base-game data model

The pure TypeScript modules in `src/game/` define the base-game data, reproducible setup, rules engine, player observation interface, and replay recorder. They import no React or browser APIs. Engine acceptance cases run in `tests/engine-acceptance.test.ts`.

## Definitions and geometry

`pieces.ts` defines the nine piece IDs, their levels, canonical masks, and unique rotations and reflections. Each level equals the piece's occupied area. There are 15 physical copies of each type. `PieceInventory` contains all nine counts, including zeros; counts measure pieces rather than cells. `createInventory()` produces a fresh inventory.

`geometry.ts` converts rectangular `#`/`.` masks to grid cells. Coordinates increase rightward and downward. Puzzle masks preserve the catalog origin and holes. Piece orientations are normalized to their occupied bounding box and sorted by row, then column. Orientations enumerate canonical rotations followed by reflected rotations, omitting duplicates. A placement stores a piece ID, an index into that piece's orientation list, and the translated grid origin. Orientation indices are stable for this schema; changing their ordering requires a replay/state migration.

`puzzles.ts` imports the existing publisher catalog and provides `PUZZLES` and `getPuzzle(id)`. Static definitions include physical ID, source number, deck color, points, reward, mask, and derived geometry. Definitions and their geometry are frozen. Physical cards with identical designs retain distinct IDs. State references these definitions by ID rather than duplicating their geometry.

## Authoritative state

`state.ts` defines a serializable `GameState` with readonly fields. Engine updates should produce new state; readonly typing is not a runtime validation or deep-freezing guarantee. Arrays and inventory counts still require the invariants in [rules.md](rules.md) to be checked by the engine.

Shared state contains fixed clockwise seating, the first player, configuration, reserve, both ordered decks, four fixed market slots per color (`null` marks a vacancy), excluded black puzzles, PRNG seed and current state, and a latched endgame schedule. The first deck element is the next draw; rounds start at one. A null endgame schedule means the black-deck trigger has not happened.

Each player has a personal supply, unfinished puzzles with placements, completed puzzle IDs, and the count and commitment flag for Finishing Touches. A placed piece is counted by its placement, so it is absent from personal supply. Completed puzzles hold no placements after completion returns their pieces.

Game phase is a discriminated union:

- `turns` contains the active player, round, remaining actions, Master flag, post-trigger black-Take counter, and completion state. Completion is either clear, awaiting an order of filled puzzle IDs, or resolving the chosen order at a given index. Filled puzzles remain unfinished until resolution; the engine must prevent normal actions while choices are pending and commit all Master placements before resolving completions.
- `finishing-touches` contains the active player. Placements remain in unfinished puzzles until commitment; each player's count records the penalty. Commitment and delayed completion are engine responsibilities.
- `scored` contains the score breakdowns, ranks, and winner IDs. Negative totals and shared ranks are supported. This phase has no active turn.

This state is internal: deck order and completed IDs can reveal hidden information. `observation.ts` exposes deck counts without deck order, includes visible personal supplies, and hides opponents' completed IDs unless the visible-score option is enabled. Returned observations are independent copies, so consumers cannot mutate authoritative state through a player view.

## Seeded setup

`createGame({ players, seed, visibleScores })` accepts 2–4 named players in clockwise order with unique nonempty IDs and an unsigned 32-bit seed. Visible scores default to false. It uses Mulberry32 and Fisher–Yates shuffling, selects 12/14/16 black cards, reveals four cards per deck, randomly chooses the first player, and allocates one single and one domino per player from the reserve. Excluded black cards remain recorded separately. The returned state starts at round one with three actions and no pending completion or endgame trigger.

The seed and stored current PRNG state allow deterministic setup and later random draws. Reproducibility depends on the algorithm, catalog ordering, and sequence of random calls; deliberate changes require a state-schema/replay version decision. Setup uses no ambient randomness, time, or UI state. It validates its inputs, but loading arbitrary saved games will need separate validation.

## Rules engine

`engine.ts` exports `applyAction`, which returns a new state or throws `RuleError` for an illegal action. It handles Take, Recycle, Upgrade, Place, and atomic Master actions; validates piece placement geometry and reserve fallback; starts completion resolution only after an action; and advances turns and the final-round schedule after completion choices finish. `chooseCompletionOrder` and `resolveCompletionReward` resolve simultaneous puzzles sequentially against the live reserve. `finishTouches` commits one player's final placement batch, returns pieces from puzzles completed in that batch without rewards, and scores once every player commits. `legalPlacements`, `acquisitionCandidates`, and `isPieceInventoryConserved` support UI previews and invariant checks without changing state.

The engine deliberately keeps completion order and fallback reward choices as explicit transitions so a caller can record them in a replay. `replay.ts` applies decisions for online multiplayer, records transitions, and verifies replay state hashes. `observation.ts` provides private player views for online rooms.

`staging.ts` previews and validates uncommitted placements for the online game controls.

The public import surface is `src/game/index.ts`. For example:

```ts
import { createGame, getPuzzle, PIECES } from './game/index.js'

const game = createGame({
  players: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
  seed: 42,
})
const firstWhite = game.market.white[0]
if (firstWhite !== null) console.log(getPuzzle(firstWhite).shape)
console.log(PIECES['tet-l'].orientations)
```

## Validation

`npm test` compiles the standalone model and tests, then runs Node's built-in test runner. It covers shape geometry, setup and conservation, action edge cases, observation privacy, replay verification, and online games through final scoring.
