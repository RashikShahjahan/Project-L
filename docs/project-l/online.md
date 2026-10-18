# Online multiplayer

Online play uses one Node.js server process with SQLite persistence. Rooms, seats, session tokens, authoritative game state (including hidden decks and random state), revisions, and the latest 500 command retry receipts per room are stored in `data/project-l.sqlite` by default. Each room change and its retry receipt commit together before any snapshot or acknowledgement is sent. Only live sockets and command queues stay in memory. After a restart, players appear disconnected until they reconnect with their browser's saved session. The server removes rooms after two hours without room activity, including time spent offline, and sweeps expired rooms at startup.

## Local development

Install dependencies with `npm ci`, then run the server and Vite in separate terminals:

```sh
npm run server:dev
npm run dev
```

Vite forwards `/ws` to `ws://localhost:8787`, so the browser can use its normal local URL. Open that URL in two browser profiles. For separate computers on the same network, run `npm run dev -- --host 0.0.0.0` and use the host computer's LAN address with Vite's port. Then create a room in one, and join with the room code in the other. The server health endpoint is `http://localhost:8787/health`.

## Single-instance deployment

Build the browser app and server, then start the server process:

```sh
npm ci
npm run build
npm run server:start
```

The Node process serves the built `dist/` frontend and `/health` endpoint on port `8787` by default. Set `PORT` to choose another port. Put a TLS reverse proxy or managed HTTPS ingress in front of it, forwarding normal HTTP requests and WebSocket upgrades to the same Node process. The browser connects to `/ws` on its page origin, using WSS automatically when the page uses HTTPS. If the deployment serves the frontend from a different origin, set `VITE_ONLINE_URL` at frontend build time to the public WebSocket URL (for example `wss://play.example.com/ws`) and set `FRONTEND_ORIGIN` on the server to that frontend's exact origin (for example `https://play.example.com`).

Use Node.js 22.13+ for the built-in `node:sqlite` module. Set `DATABASE_PATH` to choose the database file, for example:

```sh
DATABASE_PATH=/var/lib/project-l/rooms.sqlite npm run server:start
```

The parent directory is created automatically. Mount that directory on persistent storage so replacing a container or deployment preserves games. SQLite uses WAL journaling with full synchronous commits; keep its `-wal` and `-shm` files beside the database. For backups, stop the server before copying the database directory or use SQLite's online backup API. Database files contain session tokens and hidden game information; keep the database outside the public frontend directory. Database and journal files are ignored by Git.

Run one server instance with process supervision and health checks against `/health`. Restarts preserve active games; live socket ownership and broadcasts remain process-local, so multiple replicas must not share this database. `SIGINT` and `SIGTERM` close connections and the database cleanly. Tests can pass `databasePath: ':memory:'` to `RoomService` or `startServer` for isolated SQLite databases; closing the server also closes its room service.

## Room lifecycle

Disconnecting or closing the page preserves the seat and its saved session so an active game can resume. Before play starts, **Leave room** releases the seat and transfers hosting to a remaining connected player (or the next remaining seat). A finished room can also be left; the server removes an empty room.

Room revisions change when seats join/leave or a game decision is accepted. Leaving an empty room or expiring a room deletes its database row, including its sessions and retry receipts. Connection-status updates preserve the revision, so reconnects do not discard staged placements or invalidate a pending command. Retried command IDs are deduplicated; an unapplied command can be retried at its original game revision when only presence changed.

The client retries transport failures even before a session exists. If browser storage is blocked, it retains the session and pending command in memory for that tab; reloading cannot recover information the browser refused to persist.

## Verification

Automated tests cover room creation/joining, host transfer, seat release, ownership, stale/concurrent commands, atomic rejection, both applied and unapplied reconnect retries, expiry, protocol validation, private observations and a complete scored WebSocket game. Persistence tests reopen real database files and verify game and session recovery, host transfer, expiry, empty-room deletion, atomic write failures, and command deduplication. A WebSocket restart test reconnects a saved session, retries an applied decision, and continues play. Browser storage and staged-placement helpers have focused regression checks. Hosted HTTPS/WSS deployment remains pending at the user's request.
