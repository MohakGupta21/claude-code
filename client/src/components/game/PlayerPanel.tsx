import { memo } from 'react';
import type { GameState } from '../../../../shared/types';
import { COLOR_LABEL } from '../../lib/players';
import { squareLabel } from '../../lib/describe';
import { TokenBadge } from '../board/Token';

interface PlayerPanelProps {
  state: GameState;
  positions: Record<string, number>;
  myId: string;
}

export const PlayerPanel = memo(function PlayerPanel({ state, positions, myId }: PlayerPanelProps) {
  return (
    <section className="card player-panel" aria-labelledby="players-title">
      <h2 id="players-title" className="card-title">Players</h2>
      <ul className="player-list">
        {state.players.map((player) => {
          const isCurrent = player.id === state.currentPlayerId;
          const position = positions[player.id] ?? player.position;
          return (
            <li
              key={player.id}
              className={`player-row${isCurrent ? ' player-row--current' : ''}${player.isConnected ? '' : ' player-row--away'}`}
              aria-current={isCurrent ? 'true' : undefined}
            >
              <TokenBadge player={player} />
              <div className="player-info">
                <span className="player-name">
                  {player.name}
                  {player.id === myId && <span className="tag tag--you">You</span>}
                  {player.isHost && <span className="tag tag--host" title="Host">👑 Host</span>}
                </span>
                <span className="player-sub">
                  {COLOR_LABEL[player.color]} · {player.isConnected ? 'Online' : 'Disconnected'}
                </span>
              </div>
              <div className="player-position" aria-label={`Position ${squareLabel(position)}`}>
                <span className="player-position-label">Square</span>
                <span className="player-position-value">{squareLabel(position)}</span>
              </div>
              {isCurrent && <span className="sr-only">(current turn)</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
});
