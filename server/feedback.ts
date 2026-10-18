import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_FEEDBACK_LENGTH } from '../src/feedback.js'

/** Accept only feedback text; never persist request, player, or room metadata. */
export async function handleFeedback(req: IncomingMessage, res: ServerResponse, save: (message: string) => void): Promise<void> {
  const reply = (status: number, error?: string): void => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(error ? { error } : { saved: true }))
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    reply(405, 'Method not allowed')
    return
  }
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    reply(415, 'Send feedback as JSON')
    return
  }
  let size = 0
  const chunks: Buffer[] = []
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > 65_536) {
        reply(413, 'Feedback request is too large')
        return
      }
      chunks.push(chunk as Buffer)
    }
  } catch {
    if (!res.destroyed) reply(400, 'Could not read feedback')
    return
  }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    reply(400, 'Invalid JSON')
    return
  }
  const message = body && typeof body === 'object' && 'message' in body ? body.message : null
  if (typeof message !== 'string' || !message.trim() || message.length > MAX_FEEDBACK_LENGTH) {
    reply(400, `Enter feedback between 1 and ${MAX_FEEDBACK_LENGTH} characters`)
    return
  }
  try {
    save(message.trim())
    reply(201)
  } catch {
    reply(500, 'Could not save feedback. Please try again.')
  }
}
