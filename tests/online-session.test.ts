import assert from 'node:assert/strict'
import test from 'node:test'
import { savedPending, savePending, savedSession, saveSession } from '../src/online/session.js'
import type { PendingCommand } from '../src/online/session.js'

test('invalid persisted sessions and commands are ignored; blocked storage keeps pending moves recoverable', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  const session = { roomCode: 'AB12CD34', playerId: 'player-a', token: 'secret-token' }
  const pending: PendingCommand = {
    roomCode: session.roomCode,
    playerId: session.playerId,
    message: { type: 'start', commandId: 'start-once', expectedRevision: 1 },
  }
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } })
    values.set('project-l-online-session', JSON.stringify({ ...session, token: 1 }))
    assert.equal(savedSession(), null)
    values.set('project-l-online-session', JSON.stringify(session))
    assert.deepEqual(savedSession(), session)
    values.set('project-l-online-pending', JSON.stringify({ ...pending, message: { type: 'start' } }))
    assert.equal(savedPending(session), null)

    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage blocked') } })
    assert.doesNotThrow(() => { saveSession(session); savePending(pending) })
    assert.deepEqual(savedSession(), session)
    assert.deepEqual(savedPending(session), pending)
    assert.equal(savedPending({ ...session, playerId: 'another-seat' }), null)
    savePending(null)
    saveSession(null)
    assert.equal(savedSession(), null)
    assert.equal(savedPending(session), null)
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
