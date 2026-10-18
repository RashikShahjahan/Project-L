import { useId, useRef, useState } from 'react'
import { MAX_FEEDBACK_LENGTH } from '../feedback.js'
import './FeedbackBox.css'

export function FeedbackBox() {
  const id = useId()
  const submitting = useRef(false)
  const [feedback, setFeedback] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'saved' | 'error'>('idle')

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !feedback.trim()) return
    submitting.current = true
    setStatus('sending')
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ message: feedback.trim() }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error('Feedback could not be saved')
      setFeedback('')
      setStatus('saved')
    } catch {
      setStatus('error')
    } finally {
      submitting.current = false
    }
  }

  return <section className="feedback-box" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Game feedback</h2>
    <p id={`${id}-privacy`}>Feedback is anonymous. Please leave out personal information.</p>
    <form onSubmit={submit}>
      <label htmlFor={`${id}-message`}>What could we improve?</label>
      <textarea id={`${id}-message`} aria-describedby={`${id}-privacy`} rows={3} required maxLength={MAX_FEEDBACK_LENGTH}
        value={feedback} disabled={status === 'sending'} placeholder="Share a bug, an idea, or how the game felt…"
        onChange={(event) => { setFeedback(event.target.value); setStatus('idle') }} />
      <div className="feedback-actions">
        <button type="submit" disabled={status === 'sending' || !feedback.trim()}>{status === 'sending' ? 'Submitting…' : 'Submit feedback'}</button>
        <span className="feedback-count">{feedback.length.toLocaleString()} / {MAX_FEEDBACK_LENGTH.toLocaleString()}</span>
      </div>
      <p className={`feedback-status ${status === 'error' ? 'feedback-error' : ''}`} role={status === 'error' ? 'alert' : 'status'}>
        {status === 'saved' ? 'Thanks! Your feedback was saved anonymously.' : status === 'error' ? 'Could not save your feedback. Your text is still here; please try again.' : ''}
      </p>
    </form>
  </section>
}
