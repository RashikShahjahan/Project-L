# Online multiplayer

Online play uses one Node.js server process. Rooms, seats, tokens, and authoritative game state live in that process's memory; a restart ends every room. The server removes rooms after two hours without room activity. Reconnect with the browser's saved room session while the room remains alive.

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

Run one server instance with persistent process supervision and health checks against `/health`. The room map is process-local, so multiple replicas or serverless instances cannot share seats and should not be used for the current in-memory implementation. Deployments should expect a process restart or replacement to end active games.

## Room lifecycle

Disconnecting or closing the page preserves the seat and its saved session so an active game can resume. Before play starts, **Leave room** releases the seat and transfers hosting to a remaining connected player (or the next remaining seat). A finished room can also be left; the server removes an empty room.

Room revisions change when seats join/leave or a game decision is accepted. Connection-status updates preserve the revision, so reconnects do not discard staged placements or invalidate a pending command. Retried command IDs are deduplicated; an unapplied command can be retried at its original game revision when only presence changed.

The client retries transport failures even before a session exists. If browser storage is blocked, it retains the session and pending command in memory for that tab; reloading cannot recover information the browser refused to persist.

## Verification

Automated tests cover room creation/joining, host transfer, seat release, ownership, stale/concurrent commands, atomic rejection, both applied and unapplied reconnect retries, expiry, protocol validation, private observations and a complete scored WebSocket game. Storage and staged-placement helpers have focused regression checks. Hosted HTTPS/WSS deployment remains pending at the user's request.
