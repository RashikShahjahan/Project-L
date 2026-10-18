import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import WebSocket from 'ws'
import { startServer } from '../server/index.js'
import { RoomService } from '../server/room-service.js'
import type { ReplayDecision } from '../src/game/replay.js'
import { legalPlacements } from '../src/game/engine.js'
import { PIECE_IDS, PIECES } from '../src/game/pieces.js'
import { getPuzzle } from '../src/game/puzzles.js'
import type { PlayerState } from '../src/game/state.js'
import type { RoomSnapshot, ServerMessage } from '../src/online/protocol.js'

class Peer {
  readonly socket: WebSocket
  private readonly messages: ServerMessage[] = []
  private readonly waiters: { predicate: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }[] = []
  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message))
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1)
        clearTimeout(waiter!.timer)
        waiter!.resolve(message)
      } else this.messages.push(message)
    })
  }
  async ready(): Promise<void> { await once(this.socket, 'open') }
  next<T extends ServerMessage>(predicate: (message: ServerMessage) => message is T, timeoutMs = 3000): Promise<T> {
    const index = this.messages.findIndex(predicate)
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0] as T)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((waiter) => waiter.timer === timer)
        if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1)
        reject(new Error('Timed out waiting for WebSocket message'))
      }, timeoutMs)
      this.waiters.push({ predicate, resolve: resolve as (message: ServerMessage) => void, reject, timer })
    })
  }
  send(message: object): void { this.socket.send(JSON.stringify(message)) }
  async closedCode(): Promise<number> {
    const [code] = await once(this.socket, 'close') as [number, Buffer]
    return code
  }
  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return
    this.socket.close()
    await once(this.socket, 'close')
  }
}
const isType = <T extends ServerMessage['type']>(type: T) => (message: ServerMessage): message is ServerMessage & { type: T } => message.type === type
const isRoom = (message: ServerMessage): message is RoomSnapshot => message.type === 'room'
const roomAfter = (revision: number) => (message: ServerMessage): message is RoomSnapshot => message.type === 'room' && message.revision > revision

test('two WebSocket clients play a complete authoritative game and receive private views', async () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined
  let host: Peer | undefined
  let guest: Peer | undefined
  try {
    server = await startServer({ port: 0, host: '127.0.0.1', roomService: new RoomService({ randomSeed: () => 31 }) })
    host = new Peer(`ws://127.0.0.1:${server.port}/ws`)
    guest = new Peer(`ws://127.0.0.1:${server.port}/ws`)
    await Promise.all([host.ready(), guest.ready()])
    host.send({ type: 'create', name: 'Host' })
    const created = await host.next(isType('created'))
    await host.next(isRoom)
    guest.send({ type: 'join', roomCode: created.roomCode, name: 'Guest' })
    const joined = await guest.next(isType('joined'))
    assert.equal(joined.roomCode, created.roomCode)
    const guestLobby = await guest.next(isRoom)
    assert.equal(guestLobby.room.seats.length, 2)
    const hostUpdated = await host.next(isRoom)
    assert.equal(hostUpdated.room.seats.length, 2)
    host.send({ type: 'start', commandId: 'start', expectedRevision: hostUpdated.revision })
    await host.next((message): message is ServerMessage & { type: 'ack' } => message.type === 'ack' && message.commandId === 'start')
    let snapshot = await host.next(roomAfter(hostUpdated.revision))
    assert.equal(snapshot.room.status, 'playing')
    assert.ok(snapshot.view)
    const guestStarted = await guest.next(roomAfter(hostUpdated.revision))
    assert.equal(guestStarted.revision, snapshot.revision)

    const inactive = snapshot.view!.activePlayerId === created.playerId ? guest : host
    inactive.send({ type: 'decision', commandId: 'out-of-turn', expectedRevision: snapshot.revision, decision: { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } } })
    const outOfTurn = await inactive.next(isType('error'))
    assert.equal(outOfTurn.code, 'out_of_turn')

    // A malformed client frame is rejected before room state changes.
    const malformedRevision = snapshot.revision
    guest.send({ type: 'decision', commandId: 'bad', expectedRevision: malformedRevision, decision: { type: 'bogus' } })
    const malformed = await guest.next(isType('error'))
    assert.equal(malformed.code, 'invalid_message')
    assert.equal(server.rooms.getSnapshot(created.roomCode, created.playerId).revision, malformedRevision)

    let command = 0
    let sawMaster = false
    let sawCompletionOrder = false
    let sawCompletionReward = false
    let sawFinishingTouches = false
    for (let steps = 0; steps < 4000; steps += 1) {
      const view = snapshot.view!
      if (view.phase === 'scored') {
        assert.equal(snapshot.room.status, 'finished')
        assert.equal(view.results?.length, 2)
        assert.ok(view.winnerIds)
        assert.ok(sawMaster, 'The online game should exercise Master')
        assert.ok(sawCompletionOrder, 'The online game should resolve at least one completion order')
        assert.ok(sawCompletionReward, 'The online game should resolve at least one completion reward')
        assert.ok(sawFinishingTouches, 'The online game should enter Finishing Touches')
        return
      }
      const actor = view.activePlayerId === created.playerId ? host : guest
      const identity = view.activePlayerId === created.playerId ? created : joined
      let decision: ReplayDecision
      if (view.phase === 'finishing-touches') { sawFinishingTouches = true; decision = { type: 'finish-touches', placements: [] } }
      else if (view.completion?.status === 'choose-order') { sawCompletionOrder = true; decision = { type: 'completion-order', order: view.completion.puzzleIds } }
      else if (view.completion?.status === 'resolve-rewards') { sawCompletionReward = true; decision = { type: 'completion-reward', piece: view.completion.candidates[0] ?? null } }
      else {
        const activePlayer = view.players.find((player) => player.id === identity.playerId)!
        const deck = view.deckCounts.black > 0 && view.blackTakesAfterTrigger === 0 ? 'black' : 'white'
        const playerState = activePlayer as PlayerState
        const target = activePlayer.unfinished[0]
        const singlePlacement = target && playerState.supply.single > 0
          ? legalPlacements(playerState, target.puzzleId, 'single')[0]
          : undefined
        if (!view.masterUsed && target && singlePlacement) {
          sawMaster = true
          decision = { type: 'action', action: { type: 'master', placements: [{ puzzleId: target.puzzleId, placement: singlePlacement }] } }
        } else if (activePlayer.unfinished.length === 0 && activePlayer.unfinished.length < 4 && view.deckCounts[deck] > 0) {
          const slot = view.market[deck].map((id, index) => id === null ? null : { id, index, area: getPuzzle(id).shape.cells.length })
            .filter((item): item is NonNullable<typeof item> => item !== null)
            .sort((a, b) => a.area - b.area)[0]
          decision = slot
            ? { type: 'action', action: { type: 'take', source: 'market', deck, slot: slot.index as 0 | 1 | 2 | 3 } }
            : { type: 'action', action: { type: 'take', source: 'deck', deck } }
        } else if (target && singlePlacement) {
          decision = { type: 'action', action: { type: 'place', puzzleId: target.puzzleId, placement: singlePlacement } }
        } else if (target && playerState.supply.single === 0 && view.reserve.single > 0) {
          decision = { type: 'action', action: { type: 'upgrade', kind: 'new', piece: 'single' } }
        } else {
          const place = target && PIECE_IDS.flatMap((piece) => playerState.supply[piece] > 0
            ? legalPlacements(playerState, target.puzzleId, piece).map((placement) => ({ type: 'place' as const, puzzleId: target.puzzleId, placement }))
            : []).sort((a, b) => PIECES[b.placement.piece].level - PIECES[a.placement.piece].level)[0]
          if (place) decision = { type: 'action', action: place }
          else if (activePlayer.unfinished.length < 4 && view.deckCounts[deck] > 0) decision = { type: 'action', action: { type: 'take', source: 'deck', deck } }
          else decision = { type: 'action', action: { type: 'recycle', deck, bottomOrder: view.market[deck].filter((id): id is NonNullable<typeof id> => id !== null) } }
        }
      }
      const commandId = `decision-${command++}`
      const previousRevision = snapshot.revision
      actor.send({ type: 'decision', commandId, expectedRevision: previousRevision, decision })
      await actor.next((message): message is ServerMessage & { type: 'ack' } => message.type === 'ack' && message.commandId === commandId)
      snapshot = await actor.next(roomAfter(previousRevision))
    }
    assert.fail('WebSocket game did not finish within the decision limit')
  } finally {
    await Promise.all([host?.close(), guest?.close()])
    await server?.close()
  }
})

test('WebSocket reconnect replaces the old socket and retries an already-applied pending command', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', roomService: new RoomService({ randomSeed: () => 41 }) })
  const peers: Peer[] = []
  const connect = async (): Promise<Peer> => {
    const peer = new Peer(`ws://127.0.0.1:${server.port}/ws`)
    peers.push(peer)
    await peer.ready()
    return peer
  }
  try {
    const host = await connect()
    const guest = await connect()
    host.send({ type: 'create', name: 'Host' })
    const created = await host.next(isType('created'))
    await host.next(isRoom)
    guest.send({ type: 'join', roomCode: created.roomCode, name: 'Guest' })
    const joined = await guest.next(isType('joined'))
    await guest.next(isRoom)
    const lobby = await host.next(isRoom)
    host.send({ type: 'start', commandId: 'start', expectedRevision: lobby.revision })
    await host.next((message): message is ServerMessage & { type: 'ack' } => message.type === 'ack' && message.commandId === 'start')
    const started = await host.next(roomAfter(lobby.revision))
    await guest.next(roomAfter(lobby.revision))
    const activeId = started.view!.activePlayerId
    const original = activeId === created.playerId ? host : guest
    const token = activeId === created.playerId ? created.token : joined.token
    const pendingId = 'pending-across-reconnect'
    const pendingDecision: ReplayDecision = { type: 'action', action: { type: 'take', source: 'deck', deck: 'black' } }
    original.send({ type: 'decision', commandId: pendingId, expectedRevision: started.revision, decision: pendingDecision })
    const accepted = await original.next(roomAfter(started.revision))
    const newSocketClosed = original.closedCode()
    const replacement = await connect()
    replacement.send({ type: 'reconnect', roomCode: created.roomCode, token })
    const reconnected = await replacement.next(isType('reconnected'))
    assert.equal(reconnected.playerId, activeId)
    assert.equal(await newSocketClosed, 4001)
    const latest = await replacement.next(isRoom)
    assert.equal(latest.revision, accepted.revision)
    replacement.send({ type: 'decision', commandId: pendingId, expectedRevision: started.revision, decision: pendingDecision })
    const retryAck = await replacement.next((message): message is ServerMessage & { type: 'ack' } => message.type === 'ack' && message.commandId === pendingId)
    assert.equal(retryAck.revision, accepted.revision)
    assert.equal(server.rooms.getSnapshot(created.roomCode, activeId).revision, latest.revision)
    const disconnected = server.rooms.getSnapshot(created.roomCode, activeId).room.seats.find((seat) => seat.playerId === activeId)
    assert.equal(disconnected?.connected, true)
  } finally {
    await Promise.all(peers.map((peer) => peer.close()))
    await server.close()
  }
})


test('WebSocket lobby leave transfers hosting and an unsent start survives reconnect', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1' })
  const peers: Peer[] = []
  const connect = async () => {
    const peer = new Peer(`ws://127.0.0.1:${server.port}/ws`)
    peers.push(peer)
    await peer.ready()
    return peer
  }
  try {
    const host = await connect()
    host.send({ type: 'create', name: 'Host' })
    const created = await host.next(isType('created'))
    await host.next(isRoom)
    const guest = await connect()
    guest.send({ type: 'join', name: 'Guest', roomCode: created.roomCode })
    const joined = await guest.next(isType('joined'))
    await guest.next(isRoom)
    await host.next(isRoom)
    host.send({ type: 'leave' })
    await host.next(isType('left'))
    const transferred = await guest.next(isRoom)
    assert.equal(transferred.room.hostPlayerId, joined.playerId)
    assert.equal(transferred.room.seats.length, 1)

    host.send({ type: 'join', name: 'Returning player', roomCode: created.roomCode })
    await host.next(isType('joined'))
    await host.next(isRoom)
    const lobby = await guest.next(isRoom)
    await guest.close()
    const replacement = await connect()
    replacement.send({ type: 'reconnect', roomCode: created.roomCode, token: joined.token })
    await replacement.next(isType('reconnected'))
    const reconnected = await replacement.next(isRoom)
    assert.equal(reconnected.revision, lobby.revision)
    replacement.send({ type: 'start', commandId: 'not-sent-before-disconnect', expectedRevision: lobby.revision })
    await replacement.next(isType('ack'))
    const playing = await replacement.next(roomAfter(lobby.revision))
    assert.equal(playing.room.status, 'playing')
  } finally {
    await Promise.all(peers.map((peer) => peer.close()))
    await server.close()
  }
})
