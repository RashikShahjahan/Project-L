import assert from 'node:assert/strict'
import test from 'node:test'
import { RoomError, RoomService } from '../server/room-service.js'
import type { ReplayDecision } from '../src/game/replay.js'

test('rooms create, join, enforce host and seat ownership, revisions, and retries', async () => {
  const service = new RoomService({ randomSeed: () => 17 })
  const host = service.createRoom('Host', 'host-1')
  const guest = service.joinRoom(host.roomCode, 'Guest', 'guest-1')
  assert.equal(service.getSnapshot(host.roomCode, host.playerId).room.status, 'lobby')
  await assert.rejects(service.start(host.roomCode, guest.playerId, 'start-guest', 1), (error: unknown) => error instanceof RoomError && error.code === 'not_host')
  await assert.rejects(service.start(host.roomCode, host.playerId, 'start-early', 0), (error: unknown) => error instanceof RoomError && error.code === 'stale_revision')
  const revision = await service.start(host.roomCode, host.playerId, 'start-host', 1)
  assert.equal(revision, 2)
  const initial = service.getSnapshot(host.roomCode, host.playerId)
  const activeId = initial.view!.activePlayerId
  const active = activeId === host.playerId ? host : guest
  const waiting = active.playerId === host.playerId ? guest : host
  const decision: ReplayDecision = { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } }
  await assert.rejects(service.submitDecision(host.roomCode, waiting.playerId, 'out-of-turn', 2, decision), (error: unknown) => error instanceof RoomError && error.code === 'out_of_turn')
  const applied = await service.submitDecision(host.roomCode, active.playerId, 'move-1', 2, decision)
  assert.equal(applied, 3)
  assert.equal(await service.submitDecision(host.roomCode, active.playerId, 'move-1', 2, decision), 3)
  await assert.rejects(service.submitDecision(host.roomCode, active.playerId, 'move-1', 3, { type: 'completion-reward', piece: null }), (error: unknown) => error instanceof RoomError && error.code === 'command_conflict')
  await assert.rejects(service.submitDecision(host.roomCode, active.playerId, 'move-2', 2, decision), (error: unknown) => error instanceof RoomError && error.code === 'stale_revision')
})

test('lobby capacity, connected start, and start retries keep one game', async () => {
  const service = new RoomService({ randomSeed: () => 18 })
  const host = service.createRoom('Host', 'host')
  await assert.rejects(service.start(host.roomCode, host.playerId, 'start-alone', 0), (error: unknown) => error instanceof RoomError && error.code === 'not_enough_players')
  const second = service.joinRoom(host.roomCode, 'Second')
  await assert.rejects(service.start(host.roomCode, host.playerId, 'start-disconnected', 1), (error: unknown) => error instanceof RoomError && error.code === 'not_enough_players')
  service.reconnect(host.roomCode, second.token, 'second-live')
  const third = service.joinRoom(host.roomCode, 'Third', 'third-live')
  const fourth = service.joinRoom(host.roomCode, 'Fourth', 'fourth-live')
  assert.throws(() => service.joinRoom(host.roomCode, 'Fifth'), (error: unknown) => error instanceof RoomError && error.code === 'room_full')
  const startRevision = service.getSnapshot(host.roomCode, host.playerId).revision
  const firstResult = await service.start(host.roomCode, host.playerId, 'start-once', startRevision)
  assert.equal(await service.start(host.roomCode, host.playerId, 'start-once', startRevision), firstResult)
  await assert.rejects(service.start(host.roomCode, host.playerId, 'start-again', firstResult), (error: unknown) => error instanceof RoomError && error.code === 'already_started')
  assert.throws(() => service.joinRoom(host.roomCode, 'Late joiner'), (error: unknown) => error instanceof RoomError && error.code === 'game_started')
  assert.equal(service.getSnapshot(host.roomCode, third.playerId).room.seats.length, 4)
  assert.equal(service.getSnapshot(host.roomCode, fourth.playerId).room.status, 'playing')
})

test('invalid decisions are atomic and simultaneous same-revision commands serialize', async () => {
  const service = new RoomService({ randomSeed: () => 19 })
  const host = service.createRoom('Host', 'host')
  const guest = service.joinRoom(host.roomCode, 'Guest', 'guest')
  await service.start(host.roomCode, host.playerId, 'start', 1)
  const before = service.getSnapshot(host.roomCode, host.playerId)
  const active = before.view!.activePlayerId === host.playerId ? host : guest
  const invalid: ReplayDecision = { type: 'action', action: { type: 'place', puzzleId: 'base-01', placement: { piece: 'single', orientation: 0, origin: { x: 0, y: 0 } } } }
  await assert.rejects(service.submitDecision(host.roomCode, active.playerId, 'invalid', before.revision, invalid), (error: unknown) => error instanceof RoomError && error.code === 'invalid_decision')
  assert.deepEqual(service.getSnapshot(host.roomCode, host.playerId), before)

  const raceDecision: ReplayDecision = { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } }
  const race = await Promise.allSettled([
    service.submitDecision(host.roomCode, active.playerId, 'race-a', before.revision, raceDecision),
    service.submitDecision(host.roomCode, active.playerId, 'race-b', before.revision, raceDecision),
  ])
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = race.find((result) => result.status === 'rejected')
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof RoomError && rejected.reason.code === 'stale_revision')
  assert.equal(service.getSnapshot(host.roomCode, host.playerId).revision, before.revision + 1)
})

test('identical command IDs are scoped to a seat', async () => {
  const service = new RoomService({ randomSeed: () => 20 })
  const host = service.createRoom('Host', 'host')
  const guest = service.joinRoom(host.roomCode, 'Guest', 'guest')
  await service.start(host.roomCode, host.playerId, 'start', 1)
  let snapshot = service.getSnapshot(host.roomCode, host.playerId)
  let actor = snapshot.view!.activePlayerId === host.playerId ? host : guest
  const sharedId = 'same-text-id'
  let step = 0
  for (let i = 0; i < 3; i += 1) {
    const decision: ReplayDecision = i === 0
      ? { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } }
      : { type: 'action', action: { type: 'recycle', deck: 'white', bottomOrder: snapshot.view!.market.white.filter((id): id is NonNullable<typeof id> => id !== null) } }
    await service.submitDecision(host.roomCode, actor.playerId, i === 0 ? sharedId : `pass-${step++}`, snapshot.revision, decision)
    snapshot = service.getSnapshot(host.roomCode, host.playerId)
  }
  actor = snapshot.view!.activePlayerId === host.playerId ? host : guest
  assert.notEqual(actor.playerId, snapshot.view!.activePlayerId === host.playerId ? guest.playerId : host.playerId)
  const next = await service.submitDecision(host.roomCode, actor.playerId, sharedId, snapshot.revision, { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } })
  assert.equal(next, snapshot.revision + 1)
})

test('reconnect replaces a seat connection, preserves its session, and expiration removes rooms', () => {
  let now = 10
  const events: string[] = []
  const service = new RoomService({ ttlMs: 100, now: () => now })
  const host = service.createRoom('Host', 'old-connection', () => events.push('old'))
  service.disconnect('old-connection')
  assert.equal(service.getSnapshot(host.roomCode, host.playerId).room.seats[0].connected, false)
  service.reconnect(host.roomCode, host.token, 'new-connection', () => events.push('new'))
  assert.equal(service.getSnapshot(host.roomCode, host.playerId).room.seats[0].connected, true)
  service.disconnect('old-connection')
  assert.equal(service.getSnapshot(host.roomCode, host.playerId).room.seats[0].connected, true)
  assert.deepEqual(events, ['new'])
  assert.throws(() => service.reconnect(host.roomCode, 'bad-token', 'other'), (error: unknown) => error instanceof RoomError && error.code === 'invalid_session')
  now += 101
  assert.equal(service.sweepExpired(), 1)
  assert.equal(service.roomCount(), 0)
  assert.throws(() => service.getSnapshot(host.roomCode, host.playerId), (error: unknown) => error instanceof RoomError && error.code === 'room_missing')
})

test('wire player views omit hidden completed puzzles and secret setup state', async () => {
  const service = new RoomService({ randomSeed: () => 23 })
  const host = service.createRoom('Host', 'a')
  const guest = service.joinRoom(host.roomCode, 'Guest', 'b')
  await service.start(host.roomCode, host.playerId, 'start', 1)
  const view = service.getSnapshot(host.roomCode, guest.playerId).view!
  const serialized = JSON.stringify(view)
  assert.equal(serialized.includes('randomState'), false)
  assert.equal(serialized.includes('decks'), false)
  assert.equal(serialized.includes('seed'), false)
  const opponent = view.players.find((player) => player.id === host.playerId)!
  assert.equal('completed' in opponent, false)
  assert.ok('completed' in view.players.find((player) => player.id === guest.playerId)!)
})

test('a complete room game reaches final scores through serialized room decisions', async () => {
  const service = new RoomService({ randomSeed: () => 29 })
  const host = service.createRoom('Host', 'a')
  const guest = service.joinRoom(host.roomCode, 'Guest', 'b')
  await service.start(host.roomCode, host.playerId, 'start', 1)
  let revision = service.getSnapshot(host.roomCode, host.playerId).revision
  let command = 0
  for (let steps = 0; steps < 4000; steps += 1) {
    const snap = service.getSnapshot(host.roomCode, host.playerId)
    revision = snap.revision
    const view = snap.view!
    const active = view.activePlayerId
    let decision: ReplayDecision
    if (view.phase === 'finishing-touches') decision = { type: 'finish-touches', placements: [] }
    else if (view.completion?.status === 'choose-order') decision = { type: 'completion-order', order: view.completion.puzzleIds }
    else if (view.completion?.status === 'resolve-rewards') decision = { type: 'completion-reward', piece: view.completion.candidates[0] ?? null }
    else {
      const player = view.players.find((item) => item.id === active)!
      const deck = view.deckCounts.black > 0 ? 'black' : 'white'
      const market = view.market[deck]
      if (player.unfinished.length < 4 && view.deckCounts[deck] > 0) decision = { type: 'action', action: { type: 'take', source: 'deck', deck } }
      else decision = { type: 'action', action: { type: 'recycle', deck, bottomOrder: market.filter((id): id is NonNullable<typeof id> => id !== null) } }
    }
    const actor = active === host.playerId ? host : guest
    await service.submitDecision(host.roomCode, actor.playerId, `step-${command++}`, revision, decision)
    const updated = service.getSnapshot(host.roomCode, actor.playerId)
    if (updated.view?.phase === 'scored') {
      assert.equal(updated.room.status, 'finished')
      assert.equal(updated.view.results?.length, 2)
      assert.ok(updated.view.winnerIds)
      return
    }
  }
  assert.fail('Game did not finish within the decision limit')
})

test('presence updates preserve the game revision and an unapplied command survives reconnect', async () => {
  const service = new RoomService({ randomSeed: () => 17 })
  const host = service.createRoom('Host', 'host', () => {})
  const guest = service.joinRoom(host.roomCode, 'Guest', 'guest', () => {})
  const lobby = service.getSnapshot(host.roomCode, host.playerId)
  service.disconnect('host')
  service.reconnect(host.roomCode, host.token, 'host-returned', () => {})
  assert.equal(service.getSnapshot(host.roomCode, host.playerId).revision, lobby.revision)
  await service.start(host.roomCode, host.playerId, 'start-unsent', lobby.revision, 'host-returned')
  const before = service.getSnapshot(host.roomCode, host.playerId)
  const active = before.view!.activePlayerId === host.playerId ? host : guest
  const connection = active.playerId === host.playerId ? 'host-returned' : 'guest'
  service.disconnect(connection)
  service.reconnect(host.roomCode, active.token, 'active-returned', () => {})
  const latest = service.getSnapshot(host.roomCode, active.playerId)
  assert.equal(latest.revision, before.revision)
  assert.deepEqual(latest.view, service.getSnapshot(host.roomCode, active.playerId).view)
  await service.submitDecision(host.roomCode, active.playerId, 'move-unsent', before.revision,
    { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } }, 'active-returned')
  assert.equal(service.getSnapshot(host.roomCode, active.playerId).revision, before.revision + 1)
})

test('leaving releases lobby seats, transfers hosting, and removes empty rooms', async () => {
  const service = new RoomService()
  const host = service.createRoom('Host', 'host', () => {})
  const guest = service.joinRoom(host.roomCode, 'Guest', 'guest', () => {})
  assert.throws(() => service.leaveRoom(host.roomCode, host.playerId, 'wrong-connection'), /no longer owns/)
  service.leaveRoom(host.roomCode, host.playerId, 'host')
  const remaining = service.getSnapshot(host.roomCode, guest.playerId)
  assert.equal(remaining.room.hostPlayerId, guest.playerId)
  assert.equal(remaining.room.seats.length, 1)
  assert.throws(() => service.reconnect(host.roomCode, host.token), /invalid/)
  const replacement = service.joinRoom(host.roomCode, 'Replacement', 'replacement', () => {})
  await service.start(host.roomCode, guest.playerId, 'start', remaining.revision + 1, 'guest')
  assert.equal(service.getSnapshot(host.roomCode, replacement.playerId).room.status, 'playing')
  assert.throws(() => service.leaveRoom(host.roomCode, guest.playerId, 'guest'), /Disconnect to pause/)

  const solo = service.createRoom('Solo', 'solo', () => {})
  service.leaveRoom(solo.roomCode, solo.playerId, 'solo')
  assert.throws(() => service.getSnapshot(solo.roomCode, solo.playerId), /not found/)
})
