import { createServer as createHttpServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { RoomError, RoomService } from './room-service.js'
import { parseClientMessage } from '../src/online/protocol.js'
import type { ServerMessage } from '../src/online/protocol.js'

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
export interface RunningServer { readonly server: ReturnType<typeof createHttpServer>; readonly rooms: RoomService; readonly port: number; close(): Promise<void> }
export async function startServer(options: { port?: number; host?: string; staticDir?: string; roomService?: RoomService; frontendOrigin?: string } = {}): Promise<RunningServer> {
  const rooms = options.roomService ?? new RoomService()
  const staticDir = options.staticDir ?? resolve(process.cwd(), 'dist')
  const server = createHttpServer((req, res) => {
    if (req.url === '/health' || req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', rooms: rooms.roomCount() })); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return }
    const requested = (req.url ?? '/').split('?')[0] || '/'
    const safePath = normalize(requested).replace(/^([/\\]|\.\.[/\\])+/, '')
    let file = join(staticDir, safePath)
    if (!existsSync(file) || !statSync(file).isFile() || requested.endsWith('/')) file = join(staticDir, 'index.html')
    if (!existsSync(file)) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
    if (req.method === 'HEAD') res.end()
    else {
      const stream = createReadStream(file)
      stream.on('error', () => res.destroy())
      stream.pipe(res)
    }
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 })
  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin
    if (options.frontendOrigin && origin !== options.frontendOrigin) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return }
    if (request.url !== '/ws') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
  })
  let clientSequence = 0
  wss.on('connection', (ws) => {
    const connectionId = `conn-${++clientSequence}`
    let identity: { roomCode: string; playerId: string } | null = null
    const send = (message: ServerMessage): void => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)) }
    let authenticated = false
    const queued: ServerMessage[] = []
    const publish = (message: ServerMessage): void => { if (authenticated) send(message); else queued.push(message) }
    ws.on('message', (data) => {
      let msg
      try { msg = parseClientMessage(data.toString()) } catch (error) { send({ type: 'error', code: 'invalid_message', message: error instanceof Error ? error.message : 'Invalid message' }); return }
      try {
        if (msg.type === 'create' || msg.type === 'join' || msg.type === 'reconnect') {
          if (identity) throw new RoomError('already_joined', 'This connection already belongs to a room')
          const closeReplaced = (): void => ws.close(4001, 'seat replaced')
          const result = msg.type === 'create' ? rooms.createRoom(msg.name, connectionId, publish, closeReplaced)
            : msg.type === 'join' ? rooms.joinRoom(msg.roomCode, msg.name, connectionId, publish, closeReplaced)
              : rooms.reconnect(msg.roomCode, msg.token, connectionId, publish, closeReplaced)
          identity = { roomCode: result.roomCode, playerId: result.playerId }
          send({ type: msg.type === 'create' ? 'created' : msg.type === 'join' ? 'joined' : 'reconnected', ...result })
          authenticated = true
          if (queued.length) queued.splice(0).forEach(send)
          else send(rooms.getSnapshot(result.roomCode, result.playerId))
          return
        }
        if (!identity) throw new RoomError('invalid_session', 'Join or reconnect before sending room commands')
        if (msg.type === 'leave') {
          rooms.leaveRoom(identity.roomCode, identity.playerId, connectionId)
          identity = null
          authenticated = false
          send({ type: 'left' })
          return
        }
        if (msg.type === 'start') {
          if (!rooms.isConnectionActive(identity.roomCode, identity.playerId, connectionId)) throw new RoomError('connection_replaced', 'This seat connected from another browser; reconnect here to continue')
          void rooms.start(identity.roomCode, identity.playerId, msg.commandId, msg.expectedRevision, connectionId).then((revision) => send({ type: 'ack', commandId: msg.commandId, revision })).catch((error: unknown) => sendError(send, error, msg.commandId))
        } else if (msg.type === 'decision') {
          if (!rooms.isConnectionActive(identity.roomCode, identity.playerId, connectionId)) throw new RoomError('connection_replaced', 'This seat connected from another browser; reconnect here to continue')
          void rooms.submitDecision(identity.roomCode, identity.playerId, msg.commandId, msg.expectedRevision, msg.decision, connectionId).then((revision) => send({ type: 'ack', commandId: msg.commandId, revision })).catch((error: unknown) => sendError(send, error, msg.commandId))
        }
      } catch (error) { sendError(send, error) }
    })
    ws.on('pong', () => { ws.isAlive = true })
    ws.on('close', () => rooms.disconnect(connectionId))
    ws.on('error', () => rooms.disconnect(connectionId))
    ws.isAlive = true
  })
  const port = options.port ?? Number(process.env.PORT ?? 8787)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, options.host ?? '0.0.0.0', () => { server.off('error', reject); resolve() }) })
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue }
      ws.isAlive = false; ws.ping()
    }
    rooms.sweepExpired()
  }, 30_000)
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return { server, rooms, port: actualPort, close: async () => { clearInterval(heartbeat); for (const ws of wss.clients) ws.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) } }
}
function sendError(send: (message: ServerMessage) => void, error: unknown, commandId?: string): void {
  const code = error instanceof RoomError ? error.code : 'server_error'
  const message = error instanceof Error ? error.message : 'Request failed'
  send({ type: 'error', code, message, ...(commandId ? { commandId } : {}) })
}

declare module 'ws' { interface WebSocket { isAlive?: boolean } }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void startServer({ frontendOrigin: process.env.FRONTEND_ORIGIN }).then(({ port }) => console.log(`Project L server listening on ${port}`)).catch((error: unknown) => { console.error(error); process.exitCode = 1 })
}
