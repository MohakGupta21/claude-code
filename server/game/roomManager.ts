import { GAME_STATUS } from '../../shared/constants';
import type { ClientMessage, ServerMessage, SessionResponse } from '../../shared/protocol';
import type { GameState } from '../../shared/types';
import { logger } from '../logger';
import type { ActionResult, GameService } from './gameService';

export type Broadcast = (roomCode: string, message: ServerMessage) => void;

export interface RoomManagerOptions {
  reconnectGraceMs: number;
  now?: () => number;
}

type PlayerAction = Exclude<ClientMessage, { type: 'join' | 'reconnect' }>;

interface TurnSkipTimer {
  playerId: string;
  turnNumber: number;
  timer: NodeJS.Timeout;
}

/**
 * Real-time orchestration for rooms: turns socket-level happenings into service calls,
 * broadcasts the resulting state + events, and owns time-based transitions
 * (start countdown, lobby reconnection grace, skipping a disconnected player's turn).
 * Timers are only an optimisation over persisted state: after a restart they are rebuilt.
 * Work for one room is queued so broadcasts go out in the same order the database applied them.
 */
export class RoomManager {
  private readonly countdowns = new Map<string, NodeJS.Timeout>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private readonly turnSkips = new Map<string, TurnSkipTimer>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(
    private readonly service: GameService,
    private readonly broadcast: Broadcast,
    private readonly options: RoomManagerOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /** Re-arms countdowns for games that were STARTING when the server went down. */
  async resume(): Promise<void> {
    for (const roomCode of await this.service.roomCodesWithStatus(GAME_STATUS.STARTING)) {
      this.scheduleTimers(await this.service.getState(roomCode));
    }
  }

  /** Adds a player to a room's lobby and tells everyone already there. */
  join(roomCode: string, name: string): Promise<SessionResponse> {
    return this.exclusive(roomCode, async () => {
      const { session, events } = await this.service.joinGame(roomCode, name);
      this.publish(roomCode, { state: session.state, events });
      return session;
    });
  }

  connect(roomCode: string, playerId: string): Promise<GameState> {
    this.clearTimer(this.graceTimers, graceKey(roomCode, playerId));
    return this.exclusive(roomCode, async () => {
      const result = await this.service.setConnected(roomCode, playerId, true);
      this.publish(roomCode, result);
      return result.state;
    });
  }

  disconnect(roomCode: string, playerId: string): Promise<void> {
    return this.exclusive(roomCode, async () => {
      const result = await this.service.setConnected(roomCode, playerId, false);
      this.publish(roomCode, result);
      if (result.state.status === GAME_STATUS.WAITING) {
        const key = graceKey(roomCode, playerId);
        this.clearTimer(this.graceTimers, key);
        this.graceTimers.set(
          key,
          setTimeout(() => {
            this.graceTimers.delete(key);
            void this.run(roomCode, () => this.service.removeIfStillAway(roomCode, playerId));
          }, this.options.reconnectGraceMs),
        );
      }
    });
  }

  /** Applies a validated player action. Rejects with GameError for rule violations. */
  handleAction(roomCode: string, playerId: string, action: PlayerAction): Promise<ActionResult> {
    return this.exclusive(roomCode, async () => {
      const result = await this.apply(roomCode, playerId, action);
      this.publish(roomCode, result);
      return result;
    });
  }

  /** Cancels timers and waits for in-flight room work to finish. */
  async shutdown(): Promise<void> {
    for (const timer of this.countdowns.values()) clearTimeout(timer);
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    for (const skip of this.turnSkips.values()) clearTimeout(skip.timer);
    this.countdowns.clear();
    this.graceTimers.clear();
    this.turnSkips.clear();
    await Promise.all(this.queues.values());
  }

  // -------------------------------------------------------------------------

  private apply(roomCode: string, playerId: string, action: PlayerAction): Promise<ActionResult> {
    switch (action.type) {
      case 'ready':
        return this.service.setReady(roomCode, playerId, action.ready);
      case 'start':
        return this.service.startGame(roomCode, playerId);
      case 'roll_dice':
        return this.service.rollDice(roomCode, playerId);
      case 'restart':
        return this.service.restartGame(roomCode, playerId);
      case 'leave':
        this.clearTimer(this.graceTimers, graceKey(roomCode, playerId));
        return this.service.leave(roomCode, playerId);
    }
  }

  private publish(roomCode: string, result: ActionResult): void {
    if (result.events.length > 0) {
      this.broadcast(roomCode, { type: 'state', state: result.state, events: result.events });
    }
    this.scheduleTimers(result.state);
  }

  /** Runs a timer-driven transition, logging instead of throwing (there is no client to report to). */
  private async run(roomCode: string, fn: () => Promise<ActionResult>): Promise<void> {
    try {
      await this.exclusive(roomCode, async () => this.publish(roomCode, await fn()));
    } catch (error) {
      logger.error(`Timer action failed for room ${roomCode}`, error);
    }
  }

  /** Runs `task` once every earlier task for the same room has settled. */
  private exclusive<T>(roomCode: string, task: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(roomCode) ?? Promise.resolve()).then(task);
    const tail = result.catch(() => undefined);
    this.queues.set(roomCode, tail);
    void tail.then(() => {
      if (this.queues.get(roomCode) === tail) this.queues.delete(roomCode);
    });
    return result;
  }

  private scheduleTimers(state: GameState): void {
    this.scheduleCountdown(state);
    this.scheduleTurnSkip(state);
  }

  private scheduleCountdown(state: GameState): void {
    const { roomCode } = state;
    if (state.status !== GAME_STATUS.STARTING || !state.startsAt) {
      this.clearTimer(this.countdowns, roomCode);
      return;
    }
    if (this.countdowns.has(roomCode)) return;
    const delay = Math.max(0, Date.parse(state.startsAt) - this.now());
    this.countdowns.set(
      roomCode,
      setTimeout(() => {
        this.countdowns.delete(roomCode);
        void this.run(roomCode, () => this.service.beginPlay(roomCode));
      }, delay),
    );
  }

  /** If the current player is away, skip them after the grace period so the game can continue. */
  private scheduleTurnSkip(state: GameState): void {
    const { roomCode } = state;
    const current = state.players.find((p) => p.id === state.currentPlayerId);
    const someoneElseIsHere = state.players.some((p) => p.isConnected && p.id !== current?.id);
    const shouldSkip = state.status === GAME_STATUS.PLAYING && current && !current.isConnected && someoneElseIsHere;

    const existing = this.turnSkips.get(roomCode);
    if (!shouldSkip) {
      if (existing) clearTimeout(existing.timer);
      this.turnSkips.delete(roomCode);
      return;
    }
    if (existing?.playerId === current.id && existing.turnNumber === state.turnNumber) return;
    if (existing) clearTimeout(existing.timer);

    const { turnNumber } = state;
    const timer = setTimeout(() => {
      this.turnSkips.delete(roomCode);
      void this.run(roomCode, () => this.service.skipTurn(roomCode, current.id, turnNumber));
    }, this.options.reconnectGraceMs);
    this.turnSkips.set(roomCode, { playerId: current.id, turnNumber, timer });
  }

  private clearTimer(map: Map<string, NodeJS.Timeout>, key: string): void {
    const timer = map.get(key);
    if (timer) clearTimeout(timer);
    map.delete(key);
  }
}

const graceKey = (roomCode: string, playerId: string) => `${roomCode}:${playerId}`;

