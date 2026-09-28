import { randomInt } from 'node:crypto';
import type { BoardConfig } from '../../shared/boards';
import {
  DICE_MAX,
  DICE_MIN,
  GAME_STATUS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  START_POSITION,
  type GameRules,
} from '../../shared/constants';
import type { GameEvent, JumpKind, MoveResult } from '../../shared/types';
import { Errors } from '../errors';
import type { Game, Player } from './model';

/**
 * Pure Snake & Ladders rules. Every function takes a game and returns a new game plus the
 * events that describe what happened; nothing here touches I/O. The only randomness is
 * `rollDice`, which callers invoke separately so the rules stay deterministic.
 */

export interface EngineResult {
  game: Game;
  events: GameEvent[];
}

export interface RollResult extends EngineResult {
  move: MoveResult;
}

export type RandomInt = (minInclusive: number, maxExclusive: number) => number;

export function rollDice(random: RandomInt = randomInt): number {
  return random(DICE_MIN, DICE_MAX + 1);
}

export function isValidDiceValue(value: number): boolean {
  return Number.isInteger(value) && value >= DICE_MIN && value <= DICE_MAX;
}

// ---------------------------------------------------------------------------
// Movement

export interface StepResult {
  position: number;
  blocked: boolean;
  bounced: boolean;
}

/** Moves a token by the dice value, honouring the configured finish rule. */
export function movePlayer(position: number, diceValue: number, boardSize: number, rules: GameRules): StepResult {
  const target = position + diceValue;
  if (target <= boardSize) return { position: target, blocked: false, bounced: false };
  switch (rules.finishRule) {
    case 'exact':
      return { position, blocked: true, bounced: false };
    case 'bounce':
      return { position: boardSize - (target - boardSize), blocked: false, bounced: true };
    case 'overshoot':
      return { position: boardSize, blocked: false, bounced: false };
  }
}

export function applySnake(position: number, board: BoardConfig): number | null {
  return board.snakes[position] ?? null;
}

export function applyLadder(position: number, board: BoardConfig): number | null {
  return board.ladders[position] ?? null;
}

export function checkWinner(position: number, board: BoardConfig): boolean {
  return position === board.size;
}

export interface MoveOutcome {
  endPosition: number;
  finalPosition: number;
  jump: JumpKind | null;
  blocked: boolean;
  bounced: boolean;
}

export function computeMove(position: number, diceValue: number, board: BoardConfig, rules: GameRules): MoveOutcome {
  const step = movePlayer(position, diceValue, board.size, rules);
  const snakeTo = applySnake(step.position, board);
  const ladderTo = snakeTo === null ? applyLadder(step.position, board) : null;
  const jump: JumpKind | null = snakeTo !== null ? 'snake' : ladderTo !== null ? 'ladder' : null;
  return {
    endPosition: step.position,
    finalPosition: snakeTo ?? ladderTo ?? step.position,
    jump,
    blocked: step.blocked,
    bounced: step.bounced,
  };
}

// ---------------------------------------------------------------------------
// Turn order

export function sortByTurnOrder(players: readonly Player[]): Player[] {
  return [...players].sort((a, b) => a.turnOrder - b.turnOrder);
}

/** The player after `currentId` in turn order, wrapping around. */
export function nextTurn(players: readonly Player[], currentId: string | null): string | null {
  const ordered = sortByTurnOrder(players);
  if (ordered.length === 0) return null;
  const index = ordered.findIndex((p) => p.id === currentId);
  return ordered[(index + 1) % ordered.length].id;
}

/** The player who would play after `leavingId`, excluding the leaver. Used when the current player leaves. */
function successorOf(players: readonly Player[], leaving: Player): string | null {
  const ordered = sortByTurnOrder(players.filter((p) => p.id !== leaving.id));
  if (ordered.length === 0) return null;
  return (ordered.find((p) => p.turnOrder > leaving.turnOrder) ?? ordered[0]).id;
}

// ---------------------------------------------------------------------------
// Helpers

function findPlayer(game: Game, playerId: string): Player {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw Errors.invalidPlayer();
  return player;
}

function requireHost(game: Game, playerId: string): void {
  if (!findPlayer(game, playerId).isHost) throw Errors.notHost();
}

function updatePlayer(game: Game, playerId: string, patch: Partial<Player>): Player[] {
  return game.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p));
}

function nextColor(players: readonly Player[]): Player['color'] {
  const used = new Set(players.map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c));
  if (!color) throw Errors.roomFull();
  return color;
}

function resetPositions(players: readonly Player[]): Player[] {
  return players.map((p) => ({ ...p, position: START_POSITION }));
}

// ---------------------------------------------------------------------------
// Lobby

export interface NewPlayer {
  id: string;
  name: string;
  now: string;
}

export function addPlayer(game: Game, input: NewPlayer, maxPlayers = MAX_PLAYERS): EngineResult {
  if (game.status !== GAME_STATUS.WAITING) throw Errors.alreadyStarted();
  if (game.players.length >= maxPlayers) throw Errors.roomFull();
  const lowerName = input.name.toLocaleLowerCase();
  if (game.players.some((p) => p.name.toLocaleLowerCase() === lowerName)) throw Errors.nameTaken();

  const isHost = game.players.length === 0;
  const player: Player = {
    id: input.id,
    name: input.name,
    color: nextColor(game.players),
    position: START_POSITION,
    isHost,
    isConnected: false,
    isReady: isHost,
    turnOrder: Math.max(0, ...game.players.map((p) => p.turnOrder)) + 1,
    joinedAt: input.now,
  };
  return {
    game: { ...game, players: [...game.players, player], updatedAt: input.now },
    events: [{ type: 'PLAYER_JOINED', playerId: player.id, name: player.name }],
  };
}

export function setReady(game: Game, playerId: string, ready: boolean, now: string): EngineResult {
  const player = findPlayer(game, playerId);
  if (game.status !== GAME_STATUS.WAITING) throw Errors.alreadyStarted();
  // The host is always ready; their "ready" is pressing Start.
  if (player.isHost || player.isReady === ready) return { game, events: [] };
  return {
    game: { ...game, players: updatePlayer(game, playerId, { isReady: ready }), updatedAt: now },
    events: [{ type: 'PLAYER_READY', playerId, ready }],
  };
}

export function setConnected(game: Game, playerId: string, connected: boolean, now: string): EngineResult {
  const player = findPlayer(game, playerId);
  if (player.isConnected === connected) return { game, events: [] };
  return {
    game: { ...game, players: updatePlayer(game, playerId, { isConnected: connected }), updatedAt: now },
    events: [
      { type: connected ? 'PLAYER_RECONNECTED' : 'PLAYER_DISCONNECTED', playerId, name: player.name },
    ],
  };
}

export function canStart(game: Game, minPlayers = MIN_PLAYERS): boolean {
  return (
    game.status === GAME_STATUS.WAITING &&
    game.players.length >= minPlayers &&
    game.players.every((p) => p.isReady)
  );
}

/** Host starts the countdown. Play begins when `beginPlay` is called at `startsAt`. */
export function startGame(
  game: Game,
  playerId: string,
  now: string,
  startsAt: string,
  minPlayers = MIN_PLAYERS,
): EngineResult {
  requireHost(game, playerId);
  if (game.status !== GAME_STATUS.WAITING) throw Errors.alreadyStarted();
  if (game.players.length < minPlayers) throw Errors.notEnoughPlayers(minPlayers);
  if (!game.players.every((p) => p.isReady)) throw Errors.playersNotReady();
  return {
    game: { ...game, status: GAME_STATUS.STARTING, startsAt, players: resetPositions(game.players), updatedAt: now },
    events: [{ type: 'GAME_STARTING', startsAt }],
  };
}

export function beginPlay(game: Game, now: string): EngineResult {
  if (game.status !== GAME_STATUS.STARTING) throw Errors.notActive();
  const first = sortByTurnOrder(game.players)[0];
  if (!first) throw Errors.notActive();
  return {
    game: {
      ...game,
      status: GAME_STATUS.PLAYING,
      startsAt: null,
      currentPlayerId: first.id,
      turnNumber: 1,
      lastRoll: null,
      updatedAt: now,
    },
    events: [{ type: 'GAME_STARTED' }, { type: 'TURN_CHANGED', playerId: first.id, turnNumber: 1 }],
  };
}

// ---------------------------------------------------------------------------
// Playing

export function validateMove(game: Game, playerId: string, diceValue: number): Player {
  if (game.status !== GAME_STATUS.PLAYING) throw Errors.notActive();
  const player = findPlayer(game, playerId);
  if (game.currentPlayerId !== playerId) throw Errors.notYourTurn();
  if (!isValidDiceValue(diceValue)) throw Errors.invalidMove();
  return player;
}

export function applyRoll(
  game: Game,
  playerId: string,
  diceValue: number,
  board: BoardConfig,
  rules: GameRules,
  now: string,
): RollResult {
  const player = validateMove(game, playerId, diceValue);
  const outcome = computeMove(player.position, diceValue, board, rules);
  const won = checkWinner(outcome.finalPosition, board);
  const move: MoveResult = {
    playerId,
    diceValue,
    startPosition: player.position,
    endPosition: outcome.endPosition,
    finalPosition: outcome.finalPosition,
    jump: outcome.jump,
    blocked: outcome.blocked,
    bounced: outcome.bounced,
    won,
    turnNumber: game.turnNumber,
  };

  const events: GameEvent[] = [{ type: 'DICE_ROLLED', move }];
  if (!outcome.blocked) {
    events.push({ type: 'PLAYER_MOVED', playerId, from: move.startPosition, to: move.endPosition });
  }
  if (outcome.jump) {
    events.push({
      type: outcome.jump === 'snake' ? 'SNAKE_TRIGGERED' : 'LADDER_TRIGGERED',
      playerId,
      from: move.endPosition,
      to: move.finalPosition,
    });
  }

  const moved: Game = {
    ...game,
    players: updatePlayer(game, playerId, { position: outcome.finalPosition }),
    lastRoll: move,
    updatedAt: now,
  };

  if (won) {
    events.push({ type: 'GAME_WON', playerId, name: player.name });
    return {
      move,
      events,
      game: { ...moved, status: GAME_STATUS.FINISHED, winnerId: playerId, currentPlayerId: null },
    };
  }

  const next = nextTurn(moved.players, playerId);
  const turnNumber = game.turnNumber + 1;
  if (next) events.push({ type: 'TURN_CHANGED', playerId: next, turnNumber });
  return { move, events, game: { ...moved, currentPlayerId: next, turnNumber } };
}

/** Skips the current player's turn (used when they stay disconnected past the grace period). */
export function skipTurn(game: Game, playerId: string, now: string): EngineResult {
  if (game.status !== GAME_STATUS.PLAYING || game.currentPlayerId !== playerId) return { game, events: [] };
  const player = findPlayer(game, playerId);
  const next = nextTurn(game.players, playerId);
  const turnNumber = game.turnNumber + 1;
  const events: GameEvent[] = [{ type: 'TURN_SKIPPED', playerId, name: player.name }];
  if (next) events.push({ type: 'TURN_CHANGED', playerId: next, turnNumber });
  return { game: { ...game, currentPlayerId: next, turnNumber, updatedAt: now }, events };
}

// ---------------------------------------------------------------------------
// Leaving & restarting

export function removePlayer(game: Game, playerId: string, now: string, minPlayers = MIN_PLAYERS): EngineResult {
  const leaving = findPlayer(game, playerId);
  const remaining = game.players.filter((p) => p.id !== playerId);
  const events: GameEvent[] = [{ type: 'PLAYER_LEFT', playerId, name: leaving.name }];
  let next: Game = { ...game, players: remaining, updatedAt: now };

  if (leaving.isHost && remaining.length > 0) {
    const newHost = sortByTurnOrder(remaining)[0];
    next.players = remaining.map((p) => (p.id === newHost.id ? { ...p, isHost: true, isReady: true } : p));
    events.push({ type: 'HOST_CHANGED', playerId: newHost.id, name: newHost.name });
  }

  const isActive = game.status === GAME_STATUS.PLAYING || game.status === GAME_STATUS.STARTING;
  if (remaining.length === 0 || (game.status === GAME_STATUS.PLAYING && remaining.length < minPlayers)) {
    next = { ...next, status: GAME_STATUS.ABANDONED, currentPlayerId: null, startsAt: null };
    events.push({ type: 'GAME_ABANDONED' });
  } else if (game.status === GAME_STATUS.STARTING && remaining.length < minPlayers) {
    // Not enough players to begin after all: go back to the lobby.
    next = { ...next, status: GAME_STATUS.WAITING, startsAt: null };
  } else if (isActive && game.currentPlayerId === playerId) {
    const successor = successorOf(game.players, leaving);
    const turnNumber = game.turnNumber + 1;
    next = { ...next, currentPlayerId: successor, turnNumber };
    if (successor) events.push({ type: 'TURN_CHANGED', playerId: successor, turnNumber });
  }
  return { game: next, events };
}

/** Host starts a rematch with the same players: positions reset and a new countdown begins. */
export function restartGame(
  game: Game,
  playerId: string,
  now: string,
  startsAt: string,
  minPlayers = MIN_PLAYERS,
): EngineResult {
  requireHost(game, playerId);
  if (game.status !== GAME_STATUS.FINISHED) throw Errors.notActive();
  if (game.players.length < minPlayers) throw Errors.notEnoughPlayers(minPlayers);
  const round = game.round + 1;
  return {
    game: {
      ...game,
      status: GAME_STATUS.STARTING,
      startsAt,
      round,
      winnerId: null,
      currentPlayerId: null,
      turnNumber: 0,
      lastRoll: null,
      players: resetPositions(game.players),
      updatedAt: now,
    },
    events: [{ type: 'GAME_RESTARTED', round }, { type: 'GAME_STARTING', startsAt }],
  };
}
