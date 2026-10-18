# Codebase cleanup — October 17, 2026

The Luna audit findings have been addressed:

| Audit findings | Resolution |
| --- | --- |
| 1–6: AI enumeration, search, finishing strategy, restricted moves and inconsistent simulation policies | Removed computer opponents, simulation/RL tooling and exhaustive legal-action enumeration. |
| 7: Departed players strand rooms | Lobby leave releases the seat and transfers hosting. Active-game disconnection preserves the saved seat; finished rooms can be left. Empty rooms are removed. |
| 8–9: Presence changes erase staging and invalidate pending commands | Revisions now track membership and game decisions, while disconnect/reconnect broadcasts preserve the revision. Both delivered and undelivered retry paths have regression coverage. |
| 10: Initial connection failure cannot recover | Transport reconnect runs even before a room session exists. Entry controls wait while a saved seat reconnects. |
| 11: Storage exceptions block commands | Guarded session/pending persistence falls back to memory within the current tab. Message callback errors are no longer swallowed as JSON errors. |
| 12–14: Orphaned, obsolete and repeatedly overridden CSS | Removed the unimported stylesheet and unused action-panel selectors; consolidated final tabletop values into the primary rules. |
| 15: Dead branches and stale comments | Removed redundant conditions, unreachable controls, unused component options and the remaining computer-turn cue. Corrected the empty-reward comment. |
| 16: Duplicate local/online staging and completion UI | Shared preview/validation helpers and completion/finishing components now serve both modes. Network lifecycle state is separate from room presentation. |
| 17: Observation data aliases authoritative state | Observations and result payloads are copied at the public boundary; mutation-isolation tests cover this. |
| 18: Broad `any` fixtures | Rules fixtures use typed mutable state branches and localized clone boundaries. |
| 19: Missing lifecycle regression coverage | Added persistence, staging, presence/retry and leave/host-transfer checks. Removed CLI tests with the retired CLI. |
| 20: Obsolete milestone documentation | Replaced task scaffolding with current status and corrected catalog documentation. |
| 21: Root screenshot clutter | Moved historical images into [design/archive](design/archive/) and updated design references. |

Validation passed: typecheck, lint without warnings, all 54 tests, production build, and the 52-puzzle catalog validator. Browser checks covered initial offline recovery, lobby host transfer, reconnect during Master staging, completion rewards, turn progression and returning to local play. The 390px phone layout has no horizontal overflow. The desktop dock no longer overlaps Master; the phone dock sticks only when the market is collapsed.

In-memory online rooms still expire after two hours without activity and are lost when the server restarts. Browser storage restrictions preserve reconnect within the current tab, but cannot make that session survive a page reload when persistence is blocked.
