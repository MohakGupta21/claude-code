import { GAME_STATUS } from '../../../../shared/constants';
import type { AnimatedView } from '../../hooks/useGameAnimator';
import { findPlayer } from '../../lib/players';
import type { ConnectionStatus } from '../../lib/socket';
import type { GameState } from '../../../../shared/types';
import { Board } from '../board/Board';
import { ActivityFeed } from './ActivityFeed';
import { JumpBannerView } from './JumpBannerView';
import { AbandonedOverlay, CountdownOverlay, VictoryOverlay } from './Overlays';
import { PlayerPanel } from './PlayerPanel';
import { TurnCard } from './TurnCard';
import './game.css';

interface GameScreenProps {
  state: GameState;
  view: AnimatedView;
  myId: string;
  connection: ConnectionStatus;
  pendingRoll: boolean;
  onRoll(): void;
  onPlayAgain(): void;
  onLeave(): void;
}

export function GameScreen({ state, view, myId, connection, pendingRoll, onRoll, onPlayAgain, onLeave }: GameScreenProps) {
  const banner = view.banner;
  return (
    <div className="game-layout">
      <div className="game-board-col">
        <Board
          board={state.board}
          players={state.players}
          positions={view.positions}
          motion={view.motion}
          movingPlayerId={view.movingPlayerId}
          currentPlayerId={view.animating ? null : state.currentPlayerId}
          blockedPlayerId={view.blockedPlayerId}
          myId={myId}
        >
          {banner && (
            <JumpBannerView
              key={`${banner.playerId}-${banner.from}`}
              banner={banner}
              isMe={banner.playerId === myId}
              playerName={findPlayer(state, banner.playerId)?.name ?? 'A player'}
            />
          )}
        </Board>
      </div>
      <aside className="game-side">
        <TurnCard
          state={state}
          myId={myId}
          dice={view.dice}
          animating={view.animating}
          pendingRoll={pendingRoll}
          connection={connection}
          onRoll={onRoll}
        />
        <PlayerPanel state={state} positions={view.positions} myId={myId} />
        <ActivityFeed state={state} />
      </aside>

      {state.status === GAME_STATUS.STARTING && state.startsAt && (
        <CountdownOverlay startsAt={state.startsAt} round={state.round} />
      )}
      {state.status === GAME_STATUS.FINISHED && !view.animating && (
        <VictoryOverlay state={state} myId={myId} onPlayAgain={onPlayAgain} onLeave={onLeave} />
      )}
      {state.status === GAME_STATUS.ABANDONED && <AbandonedOverlay onLeave={onLeave} />}
    </div>
  );
}
