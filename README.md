# Project L

A browser implementation of the Project L base game. It supports 2–4 human players in private online multiplayer rooms. The rules engine is independent of React.

## Development

Use Node.js 22.13+ and npm. The server uses Node's built-in SQLite support.

```sh
npm ci
npm start
```

This starts both the game server and Vite; press **Ctrl+C** to stop them. Open the URL printed by Vite. Enter your name and create a private room, then share its link or room code with the other players. The host can start once at least two players are connected. The app opens directly to online multiplayer and automatically reconnects to a saved room session.

Take a market card or draw from a deck. The puzzle lands on your table automatically. You can also drag a market tile onto your play area. All active puzzles accept placements directly; the market stays visible beside your table on desktop. Select a piece from your tray, rotate or flip it, and click or tap a legal square to place it. You can also drag a piece onto the puzzle, rotate with **R**, flip with **F**, or use Tab and the arrow keys to focus squares and Enter or Space to place. Placement previews distinguish legal and invalid positions.

On a fresh game, an optional eight-step coach appears alongside the live table. It highlights the relevant market, workbench, supply or turn control while leaving the game playable. Use **Show on board** to reveal and scroll to the highlighted area, or collapse the coach to make more room. **Back**, **Next** and **Skip tutorial** stay available; your own confirmed puzzle takes, placements and completions can also advance the coach. It follows live turn status and does not advance for staged placements or another player's moves. Skipping dismisses it for that game. Choose **Don’t show automatically next game** to turn off automatic opening on later games; **How to play** reopens it from step one.

Click the yellow Single in the shared supply to take a new piece. Select a piece in your tray and choose **Exchange** beside it, then pick its replacement from the shared supply. **Refresh row** beside either deck (the Recycle action) lets you drag the market cards into return order or use their arrow buttons, then confirm beside that row. Single-puzzle completion order and rewards with no choice resolve automatically; simultaneous completions and reserve-shortage choices still pause for a decision. Click the **Master** coin beside your turn marker to enter Master mode; stage one piece on each eligible puzzle, then choose **Play Master**; undo and cancel are available before confirmation. If no legal placement exists, Master explains its requirement; **Need to spend an action?** exposes the legal empty Master action. During Finishing Touches, stage any placements you want and finish your turn, or finish without placing. Each finishing piece costs one point. Edits to `src/` reload automatically.

## Checks and production build

```sh
npm run typecheck
npm test
npm run lint
npm run build
npm run preview
```

The build runs TypeScript checks and writes the production app to `dist/`. Preview serves that build locally; it is not a production hosting server. `npm run lint` uses Oxlint from the official Vite React TypeScript template. TypeScript strict mode is enabled for the app and Vite configuration.

## Online multiplayer

The server owns the game and saves rooms, player sessions, game state, and command retry history to `data/project-l.sqlite`. Set `DATABASE_PATH` to choose another location. Rooms survive server restarts and expire after two hours of inactivity; see [docs/project-l/online.md](docs/project-l/online.md) for local multi-browser setup and single-instance HTTPS/WSS deployment.

## Project layout

- `src/`: React gameplay UI and styles.
- `src/game/`: React-independent puzzle definitions, piece geometry, inventories, game state, and seeded setup.
- `tests/`: rules, setup, multiplayer, replay, and observation tests using Node's built-in test runner.
- `data/base-game-puzzles.json`: complete base-game puzzle catalog.
- `docs/project-l/rules.md`: rules specification and engine acceptance cases.
- `docs/project-l/puzzle-catalog.md`: catalog schema and source provenance.
- `docs/project-l/game-model.md`: model conventions, state phases, and setup API.
- `docs/project-l/online.md`: online local development, deployment, and room lifetime.
- `docs/project-l/TODO.md`: implementation checklist and current progress.
- `scripts/`: puzzle catalog extraction and validation tools.

The setup follows the [official Vite React TypeScript template](https://vite.dev/guide/). The complete base-game puzzle catalog is encoded in `data/base-game-puzzles.json`.
