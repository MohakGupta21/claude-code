import type { ClientMessage, ServerMessage } from '../../../shared/protocol';
import type { Session } from './session';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

const CLOSE_REPLACED = 4001;
const CLOSE_LEFT = 4002;
const MAX_BACKOFF_MS = 5000;
const FATAL_ERRORS = new Set(['NOT_AUTHENTICATED', 'ROOM_NOT_FOUND', 'INVALID_PLAYER']);

export interface SocketHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
  onFatal(message: string): void;
}

/** WebSocket client for one room that authenticates on open and reconnects with backoff. */
export class GameSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private stopped = false;
  private retryTimer: number | undefined;

  constructor(
    private readonly session: Session,
    private readonly handlers: SocketHandlers,
  ) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  send(message: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    this.ws?.close(1000);
    this.ws = null;
  }

  private open(): void {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/ws/games/${this.session.roomCode}`);
    this.ws = ws;
    let welcomed = false;
    this.handlers.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');

    ws.onopen = () => {
      const type = this.attempts === 0 ? 'join' : 'reconnect';
      ws.send(JSON.stringify({ type, playerId: this.session.playerId, token: this.session.token }));
    };

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === 'welcome') {
        welcomed = true;
        this.attempts = 0;
        this.handlers.onStatus('open');
      }
      if (message.type === 'error' && !welcomed && FATAL_ERRORS.has(message.code)) {
        // Failing to authenticate means this session is gone for good (e.g. removed from the lobby).
        this.stop(message.message);
        return;
      }
      this.handlers.onMessage(message);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws || this.stopped) return;
      if (event.code === CLOSE_LEFT) return this.stop(null);
      if (event.code === CLOSE_REPLACED) return this.stop('This game was opened in another tab.');
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.attempts++;
    this.handlers.onStatus('reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 400 * 2 ** (this.attempts - 1));
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private stop(fatalMessage: string | null): void {
    this.close();
    this.handlers.onStatus('closed');
    if (fatalMessage) this.handlers.onFatal(fatalMessage);
  }
}
