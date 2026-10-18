import type { PlayerObservation } from '../game/observation.js'
import type { ReplayDecision } from '../game/replay.js'
import type { ScoreResult } from '../game/state.js'
import { PIECE_IDS } from '../game/pieces.js'
import { PUZZLES } from '../game/puzzles.js'

export interface RoomSeat { readonly playerId: string; readonly name: string; readonly connected: boolean }
export interface RoomInfo {
  readonly status: 'lobby' | 'playing' | 'finished'
  readonly hostPlayerId: string
  readonly seats: readonly RoomSeat[]
  readonly capacity: 4
}
/** A private, viewer-specific projection. It contains no deck order, seed, or random state. */
export interface PlayerView extends PlayerObservation {
  readonly config: { readonly playerCount: 2 | 3 | 4; readonly visibleScores: boolean }
  readonly masterUsed: boolean
  readonly blackTakesAfterTrigger: 0 | 1
  readonly results: readonly ScoreResult[] | null
  readonly winnerIds: readonly string[] | null
}
export interface RoomSnapshot {
  readonly type: 'room'; readonly roomCode: string; readonly revision: number
  readonly room: RoomInfo; readonly view: PlayerView | null
}
export type ClientMessage =
  | { readonly type: 'create'; readonly name: string }
  | { readonly type: 'join'; readonly roomCode: string; readonly name: string }
  | { readonly type: 'reconnect'; readonly roomCode: string; readonly token: string }
  | { readonly type: 'leave' }
  | { readonly type: 'start'; readonly commandId: string; readonly expectedRevision: number }
  | { readonly type: 'decision'; readonly commandId: string; readonly expectedRevision: number; readonly decision: ReplayDecision }
export type ServerMessage =
  | { readonly type: 'created' | 'joined' | 'reconnected'; readonly roomCode: string; readonly playerId: string; readonly token: string }
  | { readonly type: 'ack'; readonly commandId: string; readonly revision: number }
  | { readonly type: 'left' }
  | RoomSnapshot
  | { readonly type: 'error'; readonly code: string; readonly message: string; readonly commandId?: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const onlyKeys = (obj: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(obj).every((key) => keys.includes(key))
const boundedString = (v: unknown, max = 80): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const piece = (v: unknown): boolean => typeof v === 'string' && (PIECE_IDS as readonly string[]).includes(v)
const puzzle = (v: unknown): boolean => typeof v === 'string' && PUZZLES.some((item) => item.id === v)
function validDecision(v: unknown): v is ReplayDecision {
  if (!isRecord(v) || typeof v.type !== 'string') return false
  if (v.type === 'action' && onlyKeys(v, ['type', 'action'])) {
    const a = v.action
    if (!isRecord(a) || typeof a.type !== 'string') return false
    if (a.type === 'take' && onlyKeys(a, a.source === 'deck' ? ['type', 'source', 'deck'] : ['type', 'source', 'deck', 'slot'])) return (a.source === 'deck' && (a.deck === 'white' || a.deck === 'black')) || (a.source === 'market' && (a.deck === 'white' || a.deck === 'black') && Number.isInteger(a.slot) && Number(a.slot) >= 0 && Number(a.slot) <= 3)
    if (a.type === 'recycle' && onlyKeys(a, ['type', 'deck', 'bottomOrder'])) return (a.deck === 'white' || a.deck === 'black') && Array.isArray(a.bottomOrder) && a.bottomOrder.length <= 4 && a.bottomOrder.every(puzzle)
    if (a.type === 'upgrade' && onlyKeys(a, a.kind === 'new' ? ['type', 'kind', 'piece'] : ['type', 'kind', 'returnPiece', 'requestedPiece', 'piece'])) return (a.kind === 'new' && piece(a.piece)) || (a.kind === 'exchange' && piece(a.returnPiece) && piece(a.requestedPiece) && piece(a.piece))
    if (a.type === 'place' && onlyKeys(a, ['type', 'puzzleId', 'placement'])) return puzzle(a.puzzleId) && validPlacement(a.placement)
    if (a.type === 'master' && onlyKeys(a, ['type', 'placements'])) return Array.isArray(a.placements) && a.placements.length <= 4 && a.placements.every((p) => isRecord(p) && onlyKeys(p, ['puzzleId', 'placement']) && puzzle(p.puzzleId) && validPlacement(p.placement))
    return false
  }
  if (v.type === 'completion-order' && onlyKeys(v, ['type', 'order'])) return Array.isArray(v.order) && v.order.length <= 4 && v.order.every(puzzle)
  if (v.type === 'completion-reward' && onlyKeys(v, ['type', 'piece'])) return v.piece === null || piece(v.piece)
  if (v.type === 'finish-touches' && onlyKeys(v, ['type', 'placements'])) return Array.isArray(v.placements) && v.placements.length <= 80 && v.placements.every((p) => isRecord(p) && onlyKeys(p, ['puzzleId', 'placement']) && puzzle(p.puzzleId) && validPlacement(p.placement))
  return false
}
function validPlacement(v: unknown): boolean {
  if (!isRecord(v) || !onlyKeys(v, ['piece', 'orientation', 'origin']) || !piece(v.piece) || !Number.isInteger(v.orientation) || !isRecord(v.origin) || !onlyKeys(v.origin, ['x', 'y'])) return false
  return Number.isInteger(v.origin.x) && Number.isInteger(v.origin.y) && Math.abs(Number(v.origin.x)) <= 20 && Math.abs(Number(v.origin.y)) <= 20 && Number(v.orientation) >= 0 && Number(v.orientation) <= 7
}
/** Parse and fully validate a bounded JSON protocol message before touching room state. */
export function parseClientMessage(raw: unknown): ClientMessage {
  let value: unknown = raw
  if (typeof raw === 'string') {
    if (raw.length > 16_384) throw new Error('Message exceeds 16 KB limit')
    try { value = JSON.parse(raw) as unknown } catch { throw new Error('Message must be valid JSON') }
  }
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('Message must be an object with a type')
  if (value.type === 'leave' && onlyKeys(value, ['type'])) return { type: 'leave' }
  if (value.type === 'create' && onlyKeys(value, ['type', 'name']) && boundedString(value.name, 40)) return { type: 'create', name: value.name.trim() }
  if (value.type === 'join' && onlyKeys(value, ['type', 'name', 'roomCode']) && boundedString(value.name, 40) && boundedString(value.roomCode, 8)) return { type: 'join', name: value.name.trim(), roomCode: value.roomCode.toUpperCase() }
  if (value.type === 'reconnect' && onlyKeys(value, ['type', 'roomCode', 'token']) && boundedString(value.roomCode, 8) && boundedString(value.token, 128)) return { type: 'reconnect', roomCode: value.roomCode.toUpperCase(), token: value.token }
  if ((value.type === 'start' || value.type === 'decision') && onlyKeys(value, value.type === 'start' ? ['type', 'commandId', 'expectedRevision'] : ['type', 'commandId', 'expectedRevision', 'decision']) && boundedString(value.commandId, 80) && Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0) {
    if (value.type === 'start') return { type: 'start', commandId: value.commandId, expectedRevision: Number(value.expectedRevision) }
    if (validDecision(value.decision)) return { type: 'decision', commandId: value.commandId, expectedRevision: Number(value.expectedRevision), decision: value.decision }
  }
  throw new Error('Message fields are invalid or unsupported')
}
