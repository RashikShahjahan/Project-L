import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { RoomError, RoomService } from '../server/room-service.js'
import { RoomStore } from '../server/room-store.js'
import type { ReplayDecision } from '../src/game/replay.js'

function databasePath(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'project-l-rooms-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return join(directory, 'nested', 'rooms.sqlite')
}

test('SQLite restores games, private state, sessions, revisions, and retry receipts after reopening', async (t) => {
  const path = databasePath(t)
  let service = new RoomService({ databasePath: path, randomSeed: () => 17 })
  t.after(() => service.close())
  const host = service.createRoom('Host', 'host')
  const guest = service.joinRoom(host.roomCode, 'Guest', 'guest')
  await service.start(host.roomCode, host.playerId, 'start', 1)
  const initial = service.getSnapshot(host.roomCode, host.playerId)
  const active = initial.view!.activePlayerId === host.playerId ? host : guest
  const decision: ReplayDecision = { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } }
  const revision = await service.submitDecision(host.roomCode, active.playerId, 'move', initial.revision, decision)
  const before = service.getSnapshot(host.roomCode, host.playerId)
  const store = new RoomStore(path)
  const stored = store.get(host.roomCode)!
  store.close()
  assert.ok(stored.state?.random)
  assert.ok(stored.state?.decks)
  assert.equal(JSON.stringify(stored).includes('connectionId'), false)
  await service.close()

  service = new RoomService({ databasePath: path })
  assert.equal(service.roomCount(), 1)
  const restored = service.getSnapshot(host.roomCode.toLowerCase(), host.playerId)
  assert.deepEqual(restored.view, before.view)
  assert.equal(restored.revision, revision)
  assert.ok(restored.room.seats.every((seat) => !seat.connected))
  assert.equal(service.isConnectionActive(host.roomCode, host.playerId, 'host'), false)
  assert.throws(() => service.reconnect(host.roomCode, 'bad-token'), /invalid/)
  assert.deepEqual(service.reconnect(host.roomCode, host.token, 'host-new'), host)
  service.reconnect(host.roomCode, guest.token, 'guest-new')
  assert.equal(await service.start(host.roomCode, host.playerId, 'start', 1, 'host-new'), 2)
  assert.equal(await service.submitDecision(host.roomCode, active.playerId, 'move', initial.revision, decision), revision)
  await assert.rejects(service.submitDecision(host.roomCode, active.playerId, 'move', revision,
    { type: 'completion-reward', piece: null }), (error: unknown) => error instanceof RoomError && error.code === 'command_conflict')
  assert.equal(service.getSnapshot(host.roomCode, active.playerId).revision, revision)
  await service.submitDecision(host.roomCode, active.playerId, 'next', revision, decision)
  assert.equal(service.getSnapshot(host.roomCode, active.playerId).revision, revision + 1)
})

test('lobby changes, host transfers, empty-room deletion, and inactivity expiry survive reopening', async (t) => {
  const path = databasePath(t)
  let now = 1000
  const options = { databasePath: path, now: () => now, ttlMs: 100 }
  let service = new RoomService(options)
  t.after(() => service.close())
  const host = service.createRoom('Host', 'host')
  const guest = service.joinRoom(host.roomCode, 'Guest', 'guest')
  service.leaveRoom(host.roomCode, host.playerId, 'host')
  const solo = service.createRoom('Solo', 'solo')
  service.leaveRoom(solo.roomCode, solo.playerId, 'solo')
  const expiring = service.createRoom('Expiring')
  now += 50
  service.disconnect('guest')
  await service.close()
  service = new RoomService(options)
  const lobby = service.getSnapshot(host.roomCode, guest.playerId)
  assert.equal(lobby.room.hostPlayerId, guest.playerId)
  assert.equal(lobby.room.seats.length, 1)
  assert.equal(lobby.revision, 2)
  assert.throws(() => service.reconnect(host.roomCode, host.token), /invalid/)
  assert.throws(() => service.getSnapshot(solo.roomCode, solo.playerId), /not found/)
  now = 1101
  await service.close()
  service = new RoomService(options)
  assert.equal(service.roomCount(), 1)
  assert.throws(() => service.getSnapshot(expiring.roomCode, expiring.playerId), /not found/)
  assert.equal(service.getSnapshot(host.roomCode, guest.playerId).revision, 2)
  now = 1151
  assert.equal(service.sweepExpired(), 1)
  await service.close()
  service = new RoomService(options)
  assert.equal(service.roomCount(), 0)
})

test('a failed SQLite write publishes nothing and preserves state and the command for retry', async (t) => {
  const path = databasePath(t)
  const service = new RoomService({ databasePath: path, randomSeed: () => 19 })
  t.after(() => service.close())
  let published = 0
  const host = service.createRoom('Host', 'host', () => { published += 1 })
  const guest = service.joinRoom(host.roomCode, 'Guest', 'guest')
  await service.start(host.roomCode, host.playerId, 'start', 1)
  const before = service.getSnapshot(host.roomCode, host.playerId)
  const active = before.view!.activePlayerId === host.playerId ? host : guest
  const db = new DatabaseSync(path)
  t.after(() => db.close())
  db.exec("CREATE TRIGGER reject_write BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'write failed'); END")
  const eventsBefore = published
  const decision: ReplayDecision = { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } }
  await assert.rejects(service.submitDecision(host.roomCode, active.playerId, 'retry', before.revision, decision), /write failed/)
  assert.deepEqual(service.getSnapshot(host.roomCode, host.playerId), before)
  assert.equal(published, eventsBefore)
  db.exec('DROP TRIGGER reject_write')
  assert.equal(await service.submitDecision(host.roomCode, active.playerId, 'retry', before.revision, decision), before.revision + 1)
})

test('a command queued before room expiry cannot recreate its deleted row', async (t) => {
  let now = 0
  const service = new RoomService({ databasePath: databasePath(t), ttlMs: 10, now: () => now })
  t.after(() => service.close())
  const host = service.createRoom('Host', 'host')
  service.joinRoom(host.roomCode, 'Guest', 'guest')
  const pending = service.start(host.roomCode, host.playerId, 'start', 1)
  now = 11
  assert.equal(service.sweepExpired(), 1)
  await assert.rejects(pending, (error: unknown) => error instanceof RoomError && error.code === 'room_expired')
  assert.equal(service.roomCount(), 0)
})
