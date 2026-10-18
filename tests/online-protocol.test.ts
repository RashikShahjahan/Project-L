import assert from 'node:assert/strict'
import test from 'node:test'
import { parseClientMessage } from '../src/online/protocol.js'

test('online protocol normalizes room codes and bounds player supplied fields', () => {
  assert.deepEqual(parseClientMessage({ type: 'leave' }), { type: 'leave' })
  assert.throws(() => parseClientMessage({ type: 'leave', playerId: 'another-seat' }))
  assert.deepEqual(parseClientMessage({ type: 'join', roomCode: 'ab12cd', name: '  Ada  ' }), {
    type: 'join', roomCode: 'AB12CD', name: 'Ada',
  })
  assert.throws(() => parseClientMessage({ type: 'create', name: '   ' }))
  assert.throws(() => parseClientMessage({ type: 'create', name: 'a'.repeat(41) }))
  assert.throws(() => parseClientMessage('x'.repeat(16_385)), /16 KB/)
  assert.throws(() => parseClientMessage('{'), /valid JSON/)
})

test('online protocol rejects malformed and oversized gameplay payloads', () => {
  assert.throws(() => parseClientMessage({ type: 'decision', commandId: 'x', expectedRevision: 0, decision: { type: 'action', action: { type: 'take', source: 'market', deck: 'white', slot: 9 } } }))
  assert.throws(() => parseClientMessage({ type: 'decision', commandId: 'x', expectedRevision: -1, decision: { type: 'completion-reward', piece: null } }))
  assert.throws(() => parseClientMessage({ type: 'decision', commandId: 'x', expectedRevision: 0, decision: { type: 'finish-touches', placements: Array.from({ length: 53 }, () => ({ puzzleId: 'p', placement: { piece: 'I1', orientation: 0, origin: { x: 0, y: 0 } } })) } }))
  assert.deepEqual(parseClientMessage({ type: 'decision', commandId: 'retry-1', expectedRevision: 4, decision: { type: 'completion-reward', piece: null } }), {
    type: 'decision', commandId: 'retry-1', expectedRevision: 4, decision: { type: 'completion-reward', piece: null },
  })
})
