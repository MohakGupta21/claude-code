import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../../shared/constants';
import type { GameState } from '../../../../shared/types';
import { COLOR_LABEL, findPlayer } from '../../lib/players';
import type { ConnectionStatus } from '../../lib/socket';
import { TokenBadge } from '../board/Token';
import './lobby.css';

interface LobbyProps {
  state: GameState;
  myId: string;
  connection: ConnectionStatus;
  onReady(ready: boolean): void;
  onStart(): void;
}

export function Lobby({ state, myId, connection, onReady, onStart }: LobbyProps) {
  const me = findPlayer(state, myId);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const enoughPlayers = state.players.length >= MIN_PLAYERS;
  const everyoneReady = state.players.every((p) => p.isReady);
  const connected = connection === 'open';
  const emptySeats = Math.max(0, MAX_PLAYERS - state.players.length);
  const inviteLink = `${location.origin}/room/${state.roomCode}`;

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? state.roomCode : inviteLink;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      window.prompt('Copy this:', text);
    }
  };

  const startHint = !enoughPlayers
    ? `Waiting for at least ${MIN_PLAYERS} players…`
    : !everyoneReady
      ? 'Waiting for everyone to be ready…'
      : 'Everyone is ready!';

  return (
    <div className="lobby">
      <section className="card lobby-invite" aria-labelledby="invite-title">
        <p id="invite-title" className="eyebrow">Room code</p>
        <button type="button" className="lobby-code" onClick={() => copy('code')} aria-label={`Room code ${state.roomCode.split('').join(' ')}. Copy`}>
          {state.roomCode}
        </button>
        <p className="muted">Share this code with friends so they can join.</p>
        <div className="lobby-invite-actions">
          <button type="button" className="btn btn--soft" onClick={() => copy('code')}>
            {copied === 'code' ? '✓ Copied' : 'Copy code'}
          </button>
          <button type="button" className="btn btn--soft" onClick={() => copy('link')}>
            {copied === 'link' ? '✓ Copied' : 'Copy invite link'}
          </button>
        </div>
      </section>

      <section className="card lobby-players" aria-labelledby="lobby-players-title">
        <div className="lobby-players-head">
          <h2 id="lobby-players-title" className="card-title">Players</h2>
          <span className="pill">
            {state.players.length} / {MAX_PLAYERS}
          </span>
        </div>
        <ul className="seat-list">
          {state.players.map((p) => (
            <li key={p.id} className={`seat${p.isConnected ? '' : ' seat--away'}`}>
              <TokenBadge player={p} size="lg" />
              <div className="seat-info">
                <span className="seat-name">
                  {p.name}
                  {p.id === myId && <span className="tag tag--you">You</span>}
                  {p.isHost && <span className="tag tag--host">👑 Host</span>}
                </span>
                <span className="seat-sub">
                  {COLOR_LABEL[p.color]} token{p.isConnected ? '' : ' · reconnecting…'}
                </span>
              </div>
              <span className={`ready-badge${p.isReady ? ' ready-badge--on' : ''}`}>
                {p.isReady ? '✓ Ready' : 'Not ready'}
              </span>
            </li>
          ))}
          {Array.from({ length: emptySeats }, (_, i) => (
            <li key={`empty-${i}`} className="seat seat--empty" aria-label="Empty seat">
              <span className="seat-placeholder" aria-hidden="true">+</span>
              <span className="muted">Waiting for a player…</span>
            </li>
          ))}
        </ul>

        <div className="lobby-actions">
          {me?.isHost ? (
            <>
              <button
                type="button"
                className="btn btn--primary btn--xl"
                disabled={!enoughPlayers || !everyoneReady || !connected}
                onClick={onStart}
              >
                Start Game
              </button>
              <p className="muted lobby-hint" role="status">{startHint}</p>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`btn btn--xl ${me?.isReady ? 'btn--soft' : 'btn--primary'}`}
                disabled={!connected}
                onClick={() => onReady(!me?.isReady)}
                aria-pressed={me?.isReady ?? false}
              >
                {me?.isReady ? 'Not ready yet' : "I'm ready!"}
              </button>
              <p className="muted lobby-hint" role="status">
                {me?.isReady ? `Waiting for ${state.players.find((p) => p.isHost)?.name ?? 'the host'} to start…` : 'Let the host know when you are ready.'}
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
