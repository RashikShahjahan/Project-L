import { useEffect, useRef, useState } from 'react'
import { GameView } from '../components/GameView.js'
import { CompletionOrder, CompletionRewards, FinishingTouchesControls } from '../components/CompletionControls.js'
import { useTableActions } from '../components/useTableActions.js'
import { automaticCompletionDecision } from '../game/automatic-completions.js'
import type { GameAction } from '../game/engine.js'
import { previewPlayer, stagePlacement } from '../game/staging.js'
import type { PlayerView, RoomSnapshot } from './protocol.js'
import { useOnlineRoom } from './useOnlineRoom.js'
import './OnlineRoom.css'

export function OnlineRoom() {
  const room = useOnlineRoom()
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '')
  const [entryMode, setEntryMode] = useState<'create' | 'join' | null>(() => roomCode ? 'join' : null)
  const { snapshot, status, session, pending, error, message, send, start, leave } = room
  const connected = status === 'connected'
  const canEnter = connected && !session

  if (snapshot?.view) return <OnlineGame snapshot={snapshot} view={snapshot.view} room={room} />

  const link = snapshot ? `${location.origin}${location.pathname}?room=${snapshot.roomCode}` : ''
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      room.setMessage('Room link copied.')
      room.setError('')
    } catch {
      room.setError('Could not copy the link. Select and copy it above.')
    }
  }

  return <main className="online-room-shell">
    <header>
      <h1>Online table</h1>
      <span className={`online-connection ${status}`}>{connected ? 'Connected' : status === 'replaced' ? 'Seat replaced' : 'Connecting…'}</span>
    </header>
    {snapshot ? <section className="online-lobby">
      <p className="online-kicker">PRIVATE ROOM</p>
      <h2>Room {snapshot.roomCode}</h2>
      <p>Share this link with the other players:</p>
      <div className="online-share"><code>{link}</code><button onClick={copyLink}>Copy link</button></div>
      <div className="online-seats">{Array.from({ length: 4 }, (_, index) => {
        const seat = snapshot.room.seats[index]
        return <div key={seat?.playerId ?? index} className="online-seat">
          <b>{seat?.name ?? `Open seat ${index + 1}`}</b>
          <span>{seat ? seat.connected ? 'Connected' : 'Disconnected' : 'Waiting'}</span>
        </div>
      })}</div>
      {snapshot.room.hostPlayerId === session?.playerId && <button className="online-primary" disabled={!connected || !!pending || snapshot.room.seats.filter((seat) => seat.connected).length < 2} onClick={start}>Start game</button>}
      <button disabled={!connected || !!pending} onClick={leave}>Leave room</button>
    </section> : <section className="online-entry">
      <p className="online-kicker">2–4 PLAYERS · PRIVATE ROOM</p>
      <h2>{session ? 'Reconnecting to your room' : entryMode === 'join' ? 'Join a room' : entryMode === 'create' ? 'Create a room' : 'Play Project L online'}</h2>
      {session ? <p role="status">Reconnecting to {session.roomCode}…</p> : entryMode ? <form onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim() || !canEnter || entryMode === 'join' && !roomCode.trim()) return
        send(entryMode === 'create' ? { type: 'create', name: name.trim() } : { type: 'join', name: name.trim(), roomCode: roomCode.trim() })
      }}>
        <label>Your name<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label>
        {entryMode === 'join' && <label>Room code<input value={roomCode} maxLength={8} autoCapitalize="characters" onChange={(event) => setRoomCode(event.target.value.toUpperCase())} /></label>}
        <div className="online-action-row">
          <button type="submit" className="online-primary" disabled={!name.trim() || !canEnter || entryMode === 'join' && !roomCode.trim()}>{entryMode === 'join' ? 'Join room' : 'Create a room'}</button>
          <button type="button" onClick={() => { setEntryMode(null); room.setError(''); room.setMessage('') }}>Back</button>
        </div>
      </form> : <div className="online-action-row">
        <button className="online-primary" onClick={() => setEntryMode('create')}>Create a room</button>
        <button onClick={() => setEntryMode('join')}>Join a room</button>
      </div>}
    </section>}
    {(error || message || status === 'replaced') && <p className={error ? 'online-error' : 'online-status'} role="status">
      {error || message || 'This seat connected in another tab. Use that connection to continue.'}
    </p>}
  </main>
}

function OnlineGame({ snapshot, view, room }: {
  snapshot: RoomSnapshot
  view: PlayerView
  room: ReturnType<typeof useOnlineRoom>
}) {
  const { status, pending, message, error, batch, setBatch, mayAct, submit, setError } = room
  const activeName = view.players.find((player) => player.id === view.activePlayerId)?.name ?? 'Another player'
  const activeConnected = snapshot.room.seats.find((seat) => seat.playerId === view.activePlayerId)?.connected ?? false
  const completion = view.completion
  const own = view.players.find((player) => player.id === view.viewerId)!
  const ownPreview = previewPlayer(own, batch)
  const localView: PlayerView = {
    ...view,
    ownSupply: ownPreview.supply,
    players: view.players.map((player) => player.id === view.viewerId ? ownPreview : player),
  }
  const controls = useTableActions({
    resetKey: snapshot.revision,
    enabled: mayAct && view.phase === 'turns' && completion?.status === 'none',
    masterUsed: view.masterUsed,
    player: own,
    reserve: view.reserve,
    market: view.market,
    batch,
    onBatch: setBatch,
    onAction: (action) => submit({ type: 'action', action }),
  })
  function handleAction(action: GameAction) {
    if (!mayAct) return
    if (action.type !== 'place' || !controls.master && view.phase !== 'finishing-touches') {
      submit({ type: 'action', action })
      return
    }
    try {
      setBatch(stagePlacement(own, batch, { puzzleId: action.puzzleId, placement: action.placement }, controls.master))
      room.setMessage('Placement staged.')
      setError('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  const autoSubmittedRevision = useRef<number | null>(null)
  useEffect(() => {
    if (!mayAct || autoSubmittedRevision.current === snapshot.revision) return
    const decision = automaticCompletionDecision(completion)
    if (decision) {
      autoSubmittedRevision.current = snapshot.revision
      submit(decision)
    }
  }, [mayAct, snapshot.revision, completion, submit])

  const turnCue = view.phase === 'scored' ? 'Final scoring complete.'
    : status === 'replaced' ? 'This seat connected in another tab. Use that tab to continue.'
    : status !== 'connected' ? 'Reconnecting…'
    : pending ? 'Move sent. Waiting for the server…'
    : mayAct ? 'Your turn.'
    : activeConnected ? `${activeName} is playing.` : `Waiting for ${activeName} to reconnect.`

  return <div className="online-game-shell">
    <div className="online-game-status"><b>{snapshot.roomCode}</b><span>{status === 'connected' ? 'Connected' : status === 'replaced' ? 'Seat replaced' : 'Reconnecting…'}</span>{pending && <span>Move pending</span>}</div>
    <GameView state={localView} onAction={handleAction} onPlacementError={setError} viewerCanAct={mayAct} canAct={controls.canPlace || mayAct && view.phase === 'finishing-touches'} canTake={controls.canTake} tableTools={controls.tableTools} trayExchange={controls.trayExchange} reserveInteraction={controls.reserveInteraction} recycle={controls.recycle} masterMode={controls.master} stagedPuzzleIds={controls.master ? batch.map((item) => item.puzzleId) : []} menu={<span>{own.name}</span>}>
      <section className="online-controls control-panel" aria-label="Online turn controls">
        <p className="online-turn-cue" aria-live="polite">{turnCue}</p>
        {(error || message) && <p className={error ? 'online-error' : 'online-status'} role={error ? 'alert' : 'status'}>{error || message}</p>}
        {controls.toolbar}
        {mayAct && completion?.status === 'choose-order' && <CompletionOrder key={completion.puzzleIds.join('|')} puzzleIds={completion.puzzleIds} onSubmit={submit} />}
        {mayAct && completion?.status === 'resolve-rewards' && completion.candidates.length > 1 && <CompletionRewards completion={completion} onSubmit={submit} />}
        {mayAct && view.phase === 'finishing-touches' && <FinishingTouchesControls count={batch.length} onUndo={() => setBatch((items) => items.slice(0, -1))} onClear={() => setBatch([])} onFinish={() => submit({ type: 'finish-touches', placements: batch })} />}
        {view.phase === 'scored' && view.results && <div className="online-results">
          <h2>Results</h2>
          {[...view.results].sort((a, b) => a.rank - b.rank).map((result) => <p key={result.playerId}>#{result.rank} {view.players.find((player) => player.id === result.playerId)?.name} · {result.total} points</p>)}
        </div>}
        {view.phase === 'scored' && <div className="online-action-row"><button disabled={status !== 'connected'} onClick={room.leave}>Leave room</button></div>}
      </section>
    </GameView>
  </div>
}
