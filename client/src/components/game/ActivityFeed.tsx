import { memo } from 'react';
import type { GameState } from '../../../../shared/types';
import { describeMove } from '../../lib/describe';
import { findPlayer } from '../../lib/players';
import { TokenBadge } from '../board/Token';

export const ActivityFeed = memo(function ActivityFeed({ state }: { state: GameState }) {
  return (
    <section className="card activity" aria-labelledby="activity-title">
      <h2 id="activity-title" className="card-title">Recent moves</h2>
      {state.recentMoves.length === 0 ? (
        <p className="muted">No moves yet — the first roll is coming up!</p>
      ) : (
        <ol className="activity-list">
          {state.recentMoves.map((move) => {
            const player = findPlayer(state, move.playerId);
            const icon = move.won ? '🏆' : move.jump === 'snake' ? '🐍' : move.jump === 'ladder' ? '🪜' : '🎲';
            return (
              <li key={move.id} className={`activity-item${move.jump ? ` activity-item--${move.jump}` : ''}`}>
                {player ? <TokenBadge player={player} size="sm" /> : <span className="token-badge token-badge--sm">?</span>}
                <span className="activity-text">
                  <span aria-hidden="true">{icon} </span>
                  {describeMove(move, player?.name ?? 'A former player', state.board.size)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
});
