import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReplayDecision } from '../game/replay.js'
import type { StagedPlacement } from '../game/staging.js'
import { PIECE_LABELS } from '../game/piece-labels.js'
import { OnlineClient } from './client.js'
import type { ClientMessage, RoomSnapshot, ServerMessage } from './protocol.js'
import { savePending, savedPending, saveSession, savedSession } from './session.js'
import type { PendingCommand, RoomCommand } from './session.js'
import { tutorialEventForDecision } from '../components/tutorial.js'
import type { ConfirmedTutorialEvent } from '../components/tutorial.js'

export type LinkStatus = 'connecting' | 'connected' | 'disconnected' | 'replaced'

function linkedSession() {
  const linkedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase()
  const saved = savedSession()
  return linkedRoom && saved?.roomCode !== linkedRoom ? null : saved
}

function setRoomLink(roomCode: string | null): void {
  const url = new URL(location.href)
  if (roomCode) url.searchParams.set('room', roomCode)
  else url.searchParams.delete('room')
  history.replaceState(null, '', url)
}

export function useOnlineRoom() {
  const [status, setStatus] = useState<LinkStatus>('connecting')
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [session, setSession] = useState(linkedSession)
  const [authenticatedConnection, setAuthenticatedConnection] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingCommand | null>(null)
  const [batch, setBatch] = useState<StagedPlacement[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [connectionKey, setConnectionKey] = useState(0)
  const [tutorialEvents, setTutorialEvents] = useState<readonly ConfirmedTutorialEvent[]>([])
  const tutorialCommandId = useRef<string | null>(null)
  const authenticated = authenticatedConnection === connectionKey
  const clientRef = useRef<OnlineClient | null>(null)
  const snapshotRef = useRef(snapshot)
  const sessionRef = useRef(session)
  const pendingRef = useRef(pending)

  const clearPending = useCallback(() => {
    pendingRef.current = null
    setPending(null)
    savePending(null)
  }, [])

  const forgetRoom = useCallback(() => {
    saveSession(null)
    sessionRef.current = null
    snapshotRef.current = null
    setSession(null)
    setSnapshot(null)
    setAuthenticatedConnection(null)
    setBatch([])
    setTutorialEvents([])
    tutorialCommandId.current = null
    setMessage('')
    clearPending()
    setRoomLink(null)
  }, [clearPending])

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'created' || msg.type === 'joined' || msg.type === 'reconnected') {
      // Retried commands after reconnect must not advance onboarding.
      tutorialCommandId.current = null
      const next = { roomCode: msg.roomCode, playerId: msg.playerId, token: msg.token }
      sessionRef.current = next
      setSession(next)
      saveSession(next)
      setRoomLink(next.roomCode)
      setAuthenticatedConnection(connectionKey)
      setError('')
      const waiting = msg.type === 'reconnected' ? savedPending(next) : null
      pendingRef.current = waiting
      setPending(waiting)
      if (waiting) clientRef.current?.send(waiting.message)
      else savePending(null)
      return
    }
    if (msg.type === 'room') {
      const prior = snapshotRef.current
      snapshotRef.current = msg
      setSnapshot(msg)
      setError('')
      if (!prior || msg.revision !== prior.revision) setBatch([])
      return
    }
    if (msg.type === 'ack') {
      const waiting = pendingRef.current?.message
      if (waiting?.commandId !== msg.commandId) return
      if (waiting.type === 'decision' && tutorialCommandId.current === msg.commandId) {
        const event = tutorialEventForDecision(waiting.decision)
        if (event) setTutorialEvents((events) => [...events.slice(-3), { id: (events.at(-1)?.id ?? 0) + 1, event }])
      }
      tutorialCommandId.current = null
      clearPending()
      setBatch([])
      if (waiting.type === 'decision' && waiting.decision.type === 'completion-reward') {
        const piece = waiting.decision.piece
        setMessage(`Puzzle complete. Pieces returned${piece ? `; ${PIECE_LABELS[piece]} reward collected` : '; no reward remains in the reserve'}.`)
      } else setMessage('Move confirmed.')
      return
    }
    if (msg.type === 'left') {
      forgetRoom()
      setError('')
      return
    }
    if (msg.type === 'error') {
      if (msg.commandId === pendingRef.current?.message.commandId) { tutorialCommandId.current = null; clearPending() }
      if (['room_missing', 'room_expired', 'invalid_session'].includes(msg.code)) {
        forgetRoom()
        if (msg.code === 'room_expired') setConnectionKey((key) => key + 1)
      }
      setError(msg.message)
    }
  }, [clearPending, forgetRoom, connectionKey])

  useEffect(() => {
    const client = new OnlineClient(handleMessage, setStatus)
    clientRef.current = client
    client.socket.addEventListener('open', () => {
      const saved = sessionRef.current
      if (saved) client.send({ type: 'reconnect', roomCode: saved.roomCode, token: saved.token })
    })
    return () => {
      client.close()
      clientRef.current = null
    }
  }, [handleMessage, connectionKey])

  useEffect(() => {
    if (status !== 'disconnected') return
    const timer = window.setTimeout(() => {
      setStatus('connecting')
      setConnectionKey((key) => key + 1)
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [status])

  const send = (value: ClientMessage): void => {
    if (clientRef.current?.send(value)) return
    setError('Disconnected. Reconnecting…')
    setStatus('disconnected')
  }

  const queue = (command: RoomCommand): void => {
    if (status !== 'connected' || !authenticated || pendingRef.current || !session) return
    const next = { roomCode: session.roomCode, playerId: session.playerId, message: command }
    pendingRef.current = next
    tutorialCommandId.current = command.commandId
    setPending(next)
    savePending(next)
    setError('')
    setMessage('Waiting for the server…')
    send(command)
  }

  const commandId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const submit = (decision: ReplayDecision): void => {
    if (snapshot) queue({ type: 'decision', commandId: commandId(), expectedRevision: snapshot.revision, decision })
  }
  const start = (): void => {
    if (snapshot) queue({ type: 'start', commandId: commandId(), expectedRevision: snapshot.revision })
  }
  const leave = (): void => {
    if (status === 'connected' && authenticated && !pendingRef.current) send({ type: 'leave' })
  }

  const view = snapshot?.view
  const mayAct = status === 'connected' && authenticated && !pending
    && snapshot?.room.status === 'playing' && view?.activePlayerId === view?.viewerId

  return { status, snapshot, session, pending, batch, setBatch, error, setError, message, setMessage, mayAct, send, submit, start, leave, tutorialEvents }
}
