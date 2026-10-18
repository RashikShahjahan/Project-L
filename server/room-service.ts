import { randomBytes } from 'node:crypto'
import { observe } from '../src/game/observation.js'
import { applyDecision } from '../src/game/replay.js'
import type { ReplayDecision } from '../src/game/replay.js'
import { createGame } from '../src/game/setup.js'
import type { GameState } from '../src/game/state.js'
import type { PlayerView, RoomInfo, RoomSeat, RoomSnapshot, ServerMessage } from '../src/online/protocol.js'

export const DEFAULT_ROOM_TTL_MS = 2 * 60 * 60 * 1000
export class RoomError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'RoomError'; this.code = code }
}
interface Seat { playerId: string; name: string; token: string; connectionId: string | null }
interface Room {
  code: string; hostPlayerId: string; seats: Seat[]; state: GameState | null; revision: number
  lastActivity: number; decisions: Map<string, { fingerprint: string; revision: number }>
  mutex: Promise<void>
}
const randomToken = (bytes = 24): string => randomBytes(bytes).toString('base64url')
const roomCode = (): string => randomBytes(4).toString('hex').toUpperCase()

/** In-memory room authority. Publish callbacks are connection-scoped and replaced on reconnect. */
export class RoomService {
  private readonly rooms = new Map<string, Room>()
  private readonly connections = new Map<string, { roomCode: string; playerId: string; publish: (snapshot: ServerMessage) => void; close?: () => void }>()
  private readonly options: { ttlMs?: number; now?: () => number; randomSeed?: () => number }
  constructor(options: { ttlMs?: number; now?: () => number; randomSeed?: () => number } = {}) { this.options = options }
  private now(): number { return (this.options.now ?? Date.now)() }
  private room(code: string): Room {
    const room = this.rooms.get(code.toUpperCase())
    if (!room) throw new RoomError('room_missing', 'Room was not found or has expired')
    return room
  }
  private link(room: Room, playerId: string, connectionId?: string, publish?: (snapshot: ServerMessage) => void, close?: () => void): void {
    const seat = room.seats.find((item) => item.playerId === playerId)!
    if (seat.connectionId) {
      const previous = this.connections.get(seat.connectionId)
      this.connections.delete(seat.connectionId)
      previous?.close?.()
    }
    seat.connectionId = connectionId ?? null
    if (connectionId && publish) this.connections.set(connectionId, { roomCode: room.code, playerId, publish, close })
  }
  isConnectionActive(code: string, playerId: string, connectionId: string): boolean {
    const room = this.rooms.get(code)
    return room?.seats.some((seat) => seat.playerId === playerId && seat.connectionId === connectionId) ?? false
  }
  private touch(room: Room): void { room.lastActivity = this.now() }
  private info(room: Room): RoomInfo {
    return { status: room.state ? (room.state.phase === 'scored' ? 'finished' : 'playing') : 'lobby', hostPlayerId: room.hostPlayerId, seats: room.seats.map(({ playerId, name, connectionId }): RoomSeat => ({ playerId, name, connected: connectionId !== null })), capacity: 4 }
  }
  getSnapshot(code: string, viewerId: string): RoomSnapshot {
    const room = this.room(code)
    if (!room.seats.some((seat) => seat.playerId === viewerId)) throw new RoomError('invalid_session', 'This seat does not belong to the room')
    const state = room.state
    let view: PlayerView | null = null
    if (state) {
      const observation = observe(state, viewerId)
      const turn = state.phase === 'turns' ? state.turn : null
      view = {
        ...observation,
        config: { ...state.config },
        masterUsed: turn?.masterUsed ?? false,
        blackTakesAfterTrigger: turn?.blackTakesAfterTrigger ?? 0,
        results: state.phase === 'scored' ? structuredClone(state.results) : null,
        winnerIds: state.phase === 'scored' ? [...state.winnerIds] : null,
      }
    }
    return { type: 'room', roomCode: room.code, revision: room.revision, room: this.info(room), view }
  }
  private broadcast(room: Room): void {
    for (const [connectionId, client] of this.connections) {
      if (client.roomCode === room.code && room.seats.some((seat) => seat.connectionId === connectionId)) client.publish(this.getSnapshot(room.code, client.playerId))
    }
  }
  createRoom(name: string, connectionId?: string, publish?: (snapshot: ServerMessage) => void, close?: () => void): { roomCode: string; playerId: string; token: string } {
    this.validateName(name)
    let code = roomCode()
    while (this.rooms.has(code)) code = roomCode()
    const seat = { playerId: randomToken(9), name: name.trim(), token: randomToken(), connectionId: null }
    const room: Room = { code, hostPlayerId: seat.playerId, seats: [seat], state: null, revision: 0, lastActivity: this.now(), decisions: new Map(), mutex: Promise.resolve() }
    this.rooms.set(code, room)
    this.link(room, seat.playerId, connectionId, publish, close)
    return { roomCode: code, playerId: seat.playerId, token: seat.token }
  }
  joinRoom(code: string, name: string, connectionId?: string, publish?: (snapshot: ServerMessage) => void, close?: () => void): { roomCode: string; playerId: string; token: string } {
    this.validateName(name)
    const room = this.room(code)
    if (room.state) throw new RoomError('game_started', 'This room has already started')
    if (room.seats.length >= 4) throw new RoomError('room_full', 'This room already has four players')
    const seat = { playerId: randomToken(9), name: name.trim(), token: randomToken(), connectionId: null }
    room.seats.push(seat)
    this.link(room, seat.playerId, connectionId, publish, close)
    this.touch(room)
    room.revision += 1
    this.broadcast(room)
    return { roomCode: room.code, playerId: seat.playerId, token: seat.token }
  }
  reconnect(code: string, token: string, connectionId?: string, publish?: (snapshot: ServerMessage) => void, close?: () => void): { roomCode: string; playerId: string; token: string } {
    const room = this.room(code)
    const seat = room.seats.find((item) => item.token === token)
    if (!seat) throw new RoomError('invalid_session', 'Session token is invalid for this room')
    this.link(room, seat.playerId, connectionId, publish, close)
    this.touch(room)
    this.broadcast(room)
    return { roomCode: room.code, playerId: seat.playerId, token: seat.token }
  }
  disconnect(connectionId: string): void {
    const client = this.connections.get(connectionId)
    if (!client) return
    this.connections.delete(connectionId)
    const room = this.rooms.get(client.roomCode)
    if (!room) return
    const seat = room.seats.find((item) => item.playerId === client.playerId)
    if (seat?.connectionId === connectionId) {
      seat.connectionId = null
      this.touch(room)
      this.broadcast(room)
    }
  }
  leaveRoom(code: string, playerId: string, connectionId: string): void {
    const room = this.room(code)
    if (!this.isConnectionActive(room.code, playerId, connectionId)) {
      throw new RoomError('connection_replaced', 'This connection no longer owns the seat')
    }
    if (room.state && room.state.phase !== 'scored') {
      throw new RoomError('game_started', 'Disconnect to pause an active game; your seat is kept for reconnecting')
    }
    this.connections.delete(connectionId)
    room.seats = room.seats.filter((seat) => seat.playerId !== playerId)
    if (!room.seats.length) {
      this.rooms.delete(room.code)
      return
    }
    if (room.hostPlayerId === playerId) {
      room.hostPlayerId = (room.seats.find((seat) => seat.connectionId !== null) ?? room.seats[0]).playerId
    }
    room.revision += 1
    this.touch(room)
    this.broadcast(room)
  }
  async start(code: string, playerId: string, commandId: string, expectedRevision: number, connectionId?: string): Promise<number> {
    const room = this.room(code)
    return this.serial(room, () => {
      if (this.rooms.get(room.code) !== room) throw new RoomError('room_expired', 'Room expired before this command could be applied')
      if (connectionId && !this.isConnectionActive(room.code, playerId, connectionId)) throw new RoomError('connection_replaced', 'This seat connected from another browser; reconnect here to continue')
      const fingerprint = JSON.stringify({ type: 'start' })
      const duplicate = room.decisions.get(`${playerId}:${commandId}`)
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint) throw new RoomError('command_conflict', 'Command ID was already used for a different command')
        return duplicate.revision
      }
      this.checkCommand(room, playerId, expectedRevision)
      if (room.hostPlayerId !== playerId) throw new RoomError('not_host', 'Only the room host can start the game')
      if (room.state) throw new RoomError('already_started', 'The game has already started')
      if (room.seats.filter((seat) => seat.connectionId !== null).length < 2) throw new RoomError('not_enough_players', 'At least two players must be connected before starting')
      room.state = createGame({ players: room.seats.map(({ playerId: id, name }) => ({ id, name })), seed: this.seed(), visibleScores: false })
      room.revision += 1
      this.remember(room, playerId, commandId, fingerprint)
      this.touch(room)
      this.broadcast(room)
      return room.revision
    })
  }
  async submitDecision(code: string, playerId: string, commandId: string, expectedRevision: number, decision: ReplayDecision, connectionId?: string): Promise<number> {
    const room = this.room(code)
    return this.serial(room, () => {
      if (this.rooms.get(room.code) !== room) throw new RoomError('room_expired', 'Room expired before this command could be applied')
      if (connectionId && !this.isConnectionActive(room.code, playerId, connectionId)) throw new RoomError('connection_replaced', 'This seat connected from another browser; reconnect here to continue')
      const fingerprint = JSON.stringify(decision)
      const duplicate = room.decisions.get(`${playerId}:${commandId}`)
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint) throw new RoomError('command_conflict', 'Command ID was already used for a different decision')
        return duplicate.revision
      }
      this.checkCommand(room, playerId, expectedRevision)
      const state = room.state
      if (!state) throw new RoomError('not_started', 'The game has not started')
      const active = state.phase === 'turns' ? state.turn.activePlayerId : state.phase === 'finishing-touches' ? state.activePlayerId : null
      if (active !== playerId) throw new RoomError('out_of_turn', 'It is not your turn')
      let next: GameState
      try { next = applyDecision(state, decision) } catch (error) { throw new RoomError('invalid_decision', error instanceof Error ? error.message : 'Decision was rejected') }
      room.state = next
      room.revision += 1
      this.remember(room, playerId, commandId, fingerprint)
      this.touch(room)
      this.broadcast(room)
      return room.revision
    })
  }
  private serial<T>(room: Room, action: () => T): Promise<T> {
    const task = room.mutex.then(action)
    room.mutex = task.then(() => undefined, () => undefined)
    return task
  }
  private checkCommand(room: Room, playerId: string, revision: number): void {
    if (!room.seats.some((seat) => seat.playerId === playerId)) throw new RoomError('invalid_session', 'This seat does not belong to the room')
    if (room.revision !== revision) throw new RoomError('stale_revision', 'The room changed; refresh before submitting')
  }
  private remember(room: Room, playerId: string, id: string, fingerprint: string): void {
    room.decisions.set(`${playerId}:${id}`, { fingerprint, revision: room.revision })
    if (room.decisions.size > 500) room.decisions.delete(room.decisions.keys().next().value!)
  }
  sweepExpired(now = this.now()): number {
    let removed = 0
    for (const [code, room] of this.rooms) if (now - room.lastActivity > (this.options.ttlMs ?? DEFAULT_ROOM_TTL_MS)) {
      this.rooms.delete(code)
      for (const [id, client] of this.connections) if (client.roomCode === code) {
        client.publish({ type: 'error', code: 'room_expired', message: 'This room expired after two hours of inactivity' })
        client.close?.()
        this.connections.delete(id)
      }
      removed += 1
    }
    return removed
  }
  roomCount(): number { return this.rooms.size }
  private validateName(name: string): void { if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new RoomError('invalid_name', 'Name must contain 1–40 characters') }
  private seed(): number { const value = this.options.randomSeed?.() ?? randomBytes(4).readUInt32BE(0); return value >>> 0 }
}
