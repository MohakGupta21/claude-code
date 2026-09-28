import type { PlayerColor } from '../../../shared/constants';
import type { GameState, PlayerView } from '../../../shared/types';

export const COLOR_HEX: Record<PlayerColor, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#16a34a',
  yellow: '#eab308',
  purple: '#a855f7',
  orange: '#f97316',
};

export const COLOR_LABEL: Record<PlayerColor, string> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  purple: 'Purple',
  orange: 'Orange',
};

export function initial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}

export function playerName(state: GameState, playerId: string | null | undefined): string {
  return state.players.find((p) => p.id === playerId)?.name ?? 'A player';
}

export function findPlayer(state: GameState, playerId: string | null | undefined): PlayerView | undefined {
  return state.players.find((p) => p.id === playerId);
}
