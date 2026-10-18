# Project L status

The browser game supports 2–4 human players in private online rooms. Local games, computer opponents and AI tooling were removed on October 17, 2026.

Implemented:

- Complete base-game catalog, reproducible setup, pure rules engine and deterministic replays.
- Take, place, upgrade/exchange, recycle, Master, completion order/rewards, Finishing Touches and scoring.
- Mouse, touch and keyboard placement; staging, undo, previews and reduced motion.
- Authoritative online rooms, private player views, command deduplication, reconnect and pending-command recovery.
- Lobby leave with seat release and host transfer. Active-game seats remain recoverable after disconnecting or reloading.
- Online staging and completion controls, isolated observations and typed rules fixtures.

Remaining:

- Hosted HTTPS/WSS deployment, pending the user's request to deploy. See [online.md](online.md).

See [README](../../README.md) for development commands, [rules.md](rules.md) for the rules specification, [game-model.md](game-model.md) for state conventions, and [the cleanup record](codebase-audit-2026-10-17.md) for the resolved audit findings.
