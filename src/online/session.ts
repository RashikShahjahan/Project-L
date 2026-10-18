import { parseClientMessage } from './protocol.js'
import type { ClientMessage } from './protocol.js'

export interface SavedSession {
  readonly roomCode: string
  readonly playerId: string
  readonly token: string
}

export type RoomCommand = Extract<ClientMessage, { type: 'start' | 'decision' }>
export interface PendingCommand {
  readonly roomCode: string
  readonly playerId: string
  readonly message: RoomCommand
}

const SESSION_KEY = 'project-l-online-session'
const PENDING_KEY = 'project-l-online-pending'
// Keep the current tab usable when browser storage is unavailable.
const memory = new Map<string, string | null>()

function read(key: string): unknown {
  try {
    const raw = memory.has(key) ? memory.get(key) : localStorage.getItem(key)
    return raw ? JSON.parse(raw) as unknown : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  const raw = value === null ? null : JSON.stringify(value)
  memory.set(key, raw)
  try {
    if (raw === null) localStorage.removeItem(key)
    else localStorage.setItem(key, raw)
  } catch {
    // The session and pending command remain available in this tab.
  }
}

export function savedSession(): SavedSession | null {
  const value = read(SESSION_KEY)
  if (!value || typeof value !== 'object') return null
  const { roomCode, playerId, token } = value as Record<string, unknown>
  if (typeof roomCode !== 'string' || !roomCode || roomCode.length > 8
    || typeof playerId !== 'string' || !playerId
    || typeof token !== 'string' || !token) return null
  return { roomCode, playerId, token }
}

export function saveSession(session: SavedSession | null): void {
  write(SESSION_KEY, session)
}

export function savedPending(session: SavedSession): PendingCommand | null {
  const value = read(PENDING_KEY)
  if (!value || typeof value !== 'object') return null
  const pending = value as Record<string, unknown>
  if (pending.roomCode !== session.roomCode || pending.playerId !== session.playerId) return null
  try {
    const message = parseClientMessage(pending.message)
    if (message.type !== 'start' && message.type !== 'decision') return null
    return { roomCode: session.roomCode, playerId: session.playerId, message }
  } catch {
    return null
  }
}

export function savePending(pending: PendingCommand | null): void {
  write(PENDING_KEY, pending)
}
