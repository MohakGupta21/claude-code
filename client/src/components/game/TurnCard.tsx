import { useEffect } from 'react';
import { GAME_STATUS } from '../../../../shared/constants';
import type { GameState } from '../../../../shared/types';
import type { ConnectionStatus } from '../../lib/socket';
import { COLOR_HEX, findPlayer } from '../../lib/players';
import { Dice } from '../Dice';

interface TurnCardProps {
  state: GameState;
  myId: string;
  dice: { value: number | null; rolling: boolean };
  animating: boolean;
  pendingRoll: boolean;
  connection: ConnectionStatus;
  onRoll(): void;
}

/** Whose turn it is, the dice, and the roll button — the next action is always obvious here. */
export function TurnCard({ state, myId, dice, animating, pendingRoll, connection, onRoll }: TurnCardProps) {
  const current = findPlayer(state, state.currentPlayerId);
  const isMyTurn = state.status === GAME_STATUS.PLAYING && state.currentPlayerId === myId;
  const connected = connection === 'open';
  const canRoll = isMyTurn && connected && !animating && !pendingRoll;
  const bonus = state.lastDiceRoll?.extraTurn && state.lastDiceRoll.playerId === state.currentPlayerId
    ? state.lastDiceRoll.diceValue
    : null;

  useEffect(() => {
    if (!canRoll) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
      if (e.key === 'r' || e.key === 'R' || e.key === ' ') {
        e.preventDefault();
        onRoll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canRoll, onRoll]);

  let title: string;
  let subtitle: string;
  if (state.status === GAME_STATUS.STARTING) {
    title = 'Get ready!';
    subtitle = 'The game is about to begin';
  } else if (state.status !== GAME_STATUS.PLAYING) {
    title = 'Game over';
    subtitle = 'Thanks for playing';
  } else if (!connected) {
    title = 'Reconnecting…';
    subtitle = 'Hang tight, restoring your game';
  } else if (isMyTurn) {
    title = bonus ? `You rolled a ${bonus}!` : 'Your turn!';
    subtitle = animating ? 'Moving…' : bonus ? 'Roll again' : 'Roll the dice';
  } else if (bonus && current) {
    title = `${current.name} rolled a ${bonus}!`;
    subtitle = `${current.name} gets another roll…`;
  } else {
    title = `${current?.name ?? 'Someone'}'s turn`;
    subtitle = current && !current.isConnected
      ? `${current.name} is disconnected — their turn will be skipped soon`
      : `Waiting for ${current?.name ?? 'the next player'}…`;
  }

  const accent = current ? COLOR_HEX[current.color] : undefined;
  return (
    <section
      className={`card turn-card${isMyTurn ? ' turn-card--mine' : ''}`}
      style={{ '--accent': accent } as React.CSSProperties}
      aria-labelledby="turn-title"
    >
      <div className="turn-card-head">
        <div>
          <h2 id="turn-title" key={title} className="turn-title">{title}</h2>
          <p className="turn-subtitle">{subtitle}</p>
        </div>
        <Dice value={dice.value} rolling={dice.rolling || pendingRoll} />
      </div>
      <button
        type="button"
        className="btn btn--primary btn--xl roll-button"
        onClick={onRoll}
        disabled={!canRoll}
        aria-keyshortcuts="R"
      >
        <span aria-hidden="true">🎲</span> {pendingRoll || dice.rolling ? 'Rolling…' : 'Roll Dice'}
      </button>
      <dl className="turn-meta">
        <div>
          <dt>Turn</dt>
          <dd>{Math.max(state.turnNumber, 0)}</dd>
        </div>
        <div>
          <dt>Last roll</dt>
          <dd>{state.lastDiceRoll ? `${findPlayer(state, state.lastDiceRoll.playerId)?.name ?? '—'} · ${state.lastDiceRoll.diceValue}` : '—'}</dd>
        </div>
        <div>
          <dt>Round</dt>
          <dd>{state.round}</dd>
        </div>
      </dl>
    </section>
  );
}
