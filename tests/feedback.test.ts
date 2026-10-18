import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { startServer } from '../server/index.js'

test('feedback is stored anonymously in the room database and survives restart and room expiry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'project-l-feedback-'))
  const databasePath = join(directory, 'game.sqlite')
  let running: Awaited<ReturnType<typeof startServer>> | undefined
  try {
    running = await startServer({ port: 0, host: '127.0.0.1', databasePath })
    const room = running.rooms.createRoom('Private player name')
    const response = await fetch(`http://127.0.0.1:${running.port}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': 'session=private', 'x-forwarded-for': '192.0.2.1' },
      body: JSON.stringify({ message: "  It's fun! Please add a rematch. 🧩  ", playerId: room.playerId, roomCode: room.roomCode }),
    })
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { saved: true })
    running.rooms.sweepExpired(Date.now() + 3 * 60 * 60 * 1000)
    assert.equal(running.rooms.roomCount(), 0)
    await running.close()
    running = await startServer({ port: 0, host: '127.0.0.1', databasePath })
    const db = new DatabaseSync(databasePath)
    try {
      assert.deepEqual(db.prepare('PRAGMA table_info(feedback)').all().map((column) => column.name), ['id', 'message', 'created_at'])
      const rows = db.prepare('SELECT * FROM feedback').all()
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.message, "It's fun! Please add a rematch. 🧩")
      assert.equal(typeof rows[0]!.created_at, 'number')
    } finally { db.close() }
  } finally {
    await running?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('feedback API rejects invalid requests and reports database failures without claiming success', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'project-l-feedback-'))
  const databasePath = join(directory, 'game.sqlite')
  const running = await startServer({ port: 0, host: '127.0.0.1', databasePath, frontendOrigin: 'https://game.example' })
  const url = `http://127.0.0.1:${running.port}/api/feedback`
  const db = new DatabaseSync(databasePath)
  try {
    for (const body of ['{', 'null', '[]', '{}', '{"message":123}', '{"message":"  \\n  "}', JSON.stringify({ message: 'a'.repeat(5001) })]) {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      assert.equal(response.status, 400, body.slice(0, 80))
      await response.json()
    }
    const get = await fetch(url)
    assert.equal(get.status, 405)
    assert.equal(get.headers.get('allow'), 'POST')
    await get.json()
    const wrongType = await fetch(url, { method: 'POST', body: 'feedback' })
    assert.equal(wrongType.status, 415)
    await wrongType.json()
    const oversized = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'a'.repeat(70_000) }) })
    assert.equal(oversized.status, 413)
    await oversized.json()
    const crossOrigin = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example' }, body: '{"message":"hello"}' })
    assert.equal(crossOrigin.status, 403)
    await crossOrigin.text()
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM feedback').get()!.count, 0)

    db.exec("CREATE TRIGGER reject_feedback BEFORE INSERT ON feedback BEGIN SELECT RAISE(ABORT, 'private database error'); END")
    const failed = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"message":"Please add a rematch"}' })
    assert.equal(failed.status, 500)
    assert.equal(JSON.stringify(await failed.json()).includes('private database error'), false)
    db.exec('DROP TRIGGER reject_feedback')
    const accepted = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'a'.repeat(5000) }) })
    assert.equal(accepted.status, 201)
    await accepted.json()
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM feedback').get()!.count, 1)
  } finally {
    db.close()
    await running.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
