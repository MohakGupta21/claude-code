import { START_POSITION } from '../../../shared/constants';
import type { GameEvent, GameState, MoveResult } from '../../../shared/types';
import type { ToastTone } from '../hooks/useToasts';
import { playerName } from './players';

export const squareLabel = (square: number) => (square === START_POSITION ? 'Start' : String(square));

/** One-line history entry for a move. */
export function describeMove(move: MoveResult, name: string, boardSize: number): string {
  const text = describeStep(move, name, boardSize);
  return move.extraTurn ? `${text} — rolls again!` : text;
}

function describeStep(move: MoveResult, name: string, boardSize: number): string {
  if (move.won) return `${name} rolled ${move.diceValue} and reached ${boardSize}!`;
  if (move.blocked) return `${name} rolled ${move.diceValue} but needs exactly ${boardSize - move.startPosition}`;
  const base = `${name} rolled ${move.diceValue}: ${squareLabel(move.startPosition)} → ${move.endPosition}`;
  if (move.jump === 'snake') return `${base}, bitten down to ${move.finalPosition}`;
  if (move.jump === 'ladder') return `${base}, climbed up to ${move.finalPosition}`;
  if (move.bounced) return `${base} (bounced back)`;
  return base;
}

/** Notification text for room events that are not otherwise visible on the board. */
export function describeEvent(event: GameEvent, myId: string): { text: string; tone: ToastTone } | null {
  const isMe = 'playerId' in event && event.playerId === myId;
  switch (event.type) {
    case 'PLAYER_JOINED':
      return isMe ? null : { text: `${event.name} joined the room`, tone: 'success' };
    case 'PLAYER_LEFT':
      return isMe ? null : { text: `${event.name} left the game`, tone: 'info' };
    case 'PLAYER_DISCONNECTED':
      return isMe ? null : { text: `${event.name} lost connection`, tone: 'info' };
    case 'PLAYER_RECONNECTED':
      return isMe ? null : { text: `${event.name} is back`, tone: 'success' };
    case 'HOST_CHANGED':
      return { text: isMe ? 'You are now the host' : `${event.name} is now the host`, tone: 'info' };
    case 'TURN_SKIPPED':
      return { text: `${event.name}'s turn was skipped (disconnected)`, tone: 'info' };
    case 'GAME_RESTARTED':
      return { text: `Rematch! Round ${event.round} is starting`, tone: 'success' };
    case 'GAME_ABANDONED':
      return { text: 'Not enough players left to continue', tone: 'error' };
    default:
      return null;
  }
}

/** Short screen-reader announcement for a state update. */
export function announce(events: GameEvent[], state: GameState, myId: string): string | null {
  for (const event of events) {
    if (event.type === 'GAME_WON') return `${event.playerId === myId ? 'You win' : `${event.name} wins`}!`;
  }
  const rolled = events.find((e) => e.type === 'DICE_ROLLED');
  const turn = events.find((e) => e.type === 'TURN_CHANGED');
  const parts: string[] = [];
  if (rolled) parts.push(describeMove(rolled.move, playerName(state, rolled.move.playerId), state.board.size) + '.');
  if (turn) parts.push(turn.playerId === myId ? 'Your turn.' : `${playerName(state, turn.playerId)}'s turn.`);
  return parts.length ? parts.join(' ') : null;
}
