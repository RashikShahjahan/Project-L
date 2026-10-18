import type { ClientMessage, ServerMessage } from './protocol.js'

export function onlineSocketUrl(): string {
  const configured = import.meta.env.VITE_ONLINE_URL as string | undefined
  if (configured) return configured.replace(/^http/, 'ws')
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
}

export class OnlineClient {
  readonly socket: WebSocket
  private closedByClient = false
  private readonly onMessage: (message: ServerMessage) => void
  private readonly onStatus: (status: 'connected' | 'disconnected' | 'replaced') => void
  constructor(onMessage: (message: ServerMessage) => void, onStatus: (status: 'connected' | 'disconnected' | 'replaced') => void) {
    this.onMessage = onMessage
    this.onStatus = onStatus
    this.socket = new WebSocket(onlineSocketUrl())
    this.socket.addEventListener('open', () => this.onStatus('connected'))
    this.socket.addEventListener('close', (event) => { if (!this.closedByClient) this.onStatus(event.code === 4001 ? 'replaced' : 'disconnected') })
    this.socket.addEventListener('error', () => { if (!this.closedByClient) this.onStatus('disconnected') })
    this.socket.addEventListener('message', (event) => {
      let message: ServerMessage
      try {
        message = JSON.parse(String(event.data)) as ServerMessage
      } catch {
        return
      }
      this.onMessage(message)
    })
  }

  send(message: ClientMessage): boolean {
    if (this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  close(): void { this.closedByClient = true; this.socket.close() }
}
