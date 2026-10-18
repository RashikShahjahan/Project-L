import assert from 'node:assert/strict'
import test from 'node:test'
import { legalPlacements } from '../src/game/engine.js'
import { createInventory } from '../src/game/pieces.js'
import { previewPlayer, stagePlacement } from '../src/game/staging.js'

test('staging previews preserve the original player and enforce inventory, overlap and Master limits', () => {
  const player = { supply: { ...createInventory(), single: 2 }, unfinished: [{ puzzleId: 'base-01' as const, placements: [] }] }
  const original = structuredClone(player)
  const first = { puzzleId: 'base-01' as const, placement: legalPlacements(player, 'base-01', 'single')[0] }
  const batch = stagePlacement(player, [], first, true)
  const preview = previewPlayer(player, batch)
  assert.deepEqual(player, original)
  assert.equal(preview.supply.single, 1)
  assert.equal(preview.unfinished[0].placements.length, 1)
  assert.throws(() => stagePlacement(player, batch, first, true), /one placement per puzzle/)
  assert.throws(() => stagePlacement(player, batch, first, false), /not legal/)
  const next = { puzzleId: first.puzzleId, placement: legalPlacements(preview, first.puzzleId, 'single')[0] }
  const finishing = stagePlacement(player, batch, next, false)
  const exhausted = previewPlayer(player, finishing)
  assert.equal(exhausted.supply.single, 0)
  assert.equal(exhausted.unfinished[0].placements.length, 2)
  assert.throws(() => stagePlacement(player, finishing, first, false), /not legal/)
})
