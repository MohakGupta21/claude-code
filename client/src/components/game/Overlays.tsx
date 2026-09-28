import { useEffect, useMemo, useState } from 'react';
import type { GameState } from '../../../../shared/types';
import { COLOR_HEX, findPlayer } from '../../lib/players';
import { squareLabel } from '../../lib/describe';
import { TokenBadge } from '../board/Token';

export function CountdownOverlay({ startsAt, round }: { startsAt: string; round: number }) {
  const target = Date.parse(startsAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  return (
    <div className="overlay overlay--soft" role="status" aria-live="assertive">
      <div className="countdown">
        <span className="countdown-label">{round > 1 ? `Round ${round}` : 'Game starting'}</span>
        <span key={seconds} className="countdown-number">{seconds > 0 ? seconds : 'Go!'}</span>
      </div>
    </div>
  );
}

interface VictoryProps {
  state: GameState;
  myId: string;
  onPlayAgain(): void;
  onLeave(): void;
}

export function VictoryOverlay({ state, myId, onPlayAgain, onLeave }: VictoryProps) {
  const winner = findPlayer(state, state.winnerId);
  const me = findPlayer(state, myId);
  const standings = [...state.players].sort((a, b) => b.position - a.position);
  const canRestart = me?.isHost && state.players.length >= 2;
  const host = state.players.find((p) => p.isHost);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="victory-title">
      <Confetti colors={state.players.map((p) => COLOR_HEX[p.color])} />
      <div className="card victory-card">
        <div className="victory-trophy" aria-hidden="true">🏆</div>
        <h2 id="victory-title" className="victory-title">
          {winner?.id === myId ? 'You win!' : `${winner?.name ?? 'Someone'} wins!`}
        </h2>
        <p className="muted">Congratulations! {winner?.id === myId ? 'Nicely played.' : 'Better luck next round.'}</p>
        <ol className="standings">
          {standings.map((p, i) => (
            <li key={p.id}>
              <span className="standings-rank">{i + 1}</span>
              <TokenBadge player={p} size="sm" />
              <span className="standings-name">{p.name}{p.id === myId ? ' (you)' : ''}</span>
              <span className="standings-pos">{squareLabel(p.position)}</span>
            </li>
          ))}
        </ol>
        <div className="victory-actions">
          {canRestart ? (
            <button type="button" className="btn btn--primary btn--lg" onClick={onPlayAgain} autoFocus>
              Play Again
            </button>
          ) : (
            <p className="muted">
              {state.players.length < 2 ? 'Not enough players for a rematch.' : `Waiting for ${host?.name ?? 'the host'} to start a rematch…`}
            </p>
          )}
          <button type="button" className="btn btn--ghost" onClick={onLeave}>
            Leave game
          </button>
        </div>
      </div>
    </div>
  );
}

export function AbandonedOverlay({ onLeave }: { onLeave(): void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="abandoned-title">
      <div className="card victory-card">
        <div className="victory-trophy" aria-hidden="true">🍃</div>
        <h2 id="abandoned-title" className="victory-title">Game ended</h2>
        <p className="muted">Everyone else left, so this game can't continue.</p>
        <button type="button" className="btn btn--primary btn--lg" onClick={onLeave} autoFocus>
          Back to home
        </button>
      </div>
    </div>
  );
}

const CONFETTI_PIECES = 70;

function Confetti({ colors }: { colors: string[] }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_PIECES }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.2 + Math.random() * 1.6,
        rotate: Math.random() * 360,
        color: [...colors, '#ffd166', '#06d6a0'][i % (colors.length + 2)],
      })),
    [colors],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            rotate: `${p.rotate}deg`,
          }}
        />
      ))}
    </div>
  );
}
