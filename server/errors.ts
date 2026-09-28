import { ERROR_CODES, type ErrorCode } from '../shared/protocol';

/** An expected, user-facing error. Its message is safe to show to players. */
export class GameError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export const Errors = {
  roomNotFound: () => new GameError(ERROR_CODES.ROOM_NOT_FOUND, 'Room not found. Check the code and try again.'),
  roomFull: () => new GameError(ERROR_CODES.ROOM_FULL, 'This room is full.'),
  alreadyStarted: () => new GameError(ERROR_CODES.GAME_ALREADY_STARTED, 'This game has already started.'),
  notActive: () => new GameError(ERROR_CODES.GAME_NOT_ACTIVE, 'The game is not in progress.'),
  notYourTurn: () => new GameError(ERROR_CODES.NOT_YOUR_TURN, 'It is not your turn.'),
  notHost: () => new GameError(ERROR_CODES.NOT_HOST, 'Only the host can do that.'),
  notEnoughPlayers: (min: number) =>
    new GameError(ERROR_CODES.NOT_ENOUGH_PLAYERS, `At least ${min} players are needed to start.`),
  playersNotReady: () => new GameError(ERROR_CODES.PLAYERS_NOT_READY, 'Everyone needs to be ready first.'),
  nameTaken: () => new GameError(ERROR_CODES.NAME_TAKEN, 'Someone in this room already has that name.'),
  invalidPlayer: () => new GameError(ERROR_CODES.INVALID_PLAYER, 'Invalid player.'),
  invalidInput: (message: string) => new GameError(ERROR_CODES.INVALID_INPUT, message),
  invalidMove: () => new GameError(ERROR_CODES.INVALID_MOVE, 'Invalid move.'),
  notAuthenticated: () =>
    new GameError(ERROR_CODES.NOT_AUTHENTICATED, 'Your session is no longer valid. Please join the room again.'),
  rateLimited: () => new GameError(ERROR_CODES.RATE_LIMITED, 'Slow down a little!'),
};
