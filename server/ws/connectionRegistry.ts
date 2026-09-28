import { WebSocket } from 'ws';
import type { ServerMessage } from '../../shared/protocol';

export const CLOSE_REPLACED = 4001;
export const CLOSE_LEFT = 4002;

/** Tracks the single live socket of each player in each room. */
export class ConnectionRegistry {
  private readonly rooms = new Map<string, Map<string, WebSocket>>();

  /** Registers a socket, closing any older socket the same player still had open (e.g. another tab). */
  register(roomCode: string, playerId: string, socket: WebSocket): void {
    let room = this.rooms.get(roomCode);
    if (!room) {
      room = new Map();
      this.rooms.set(roomCode, room);
    }
    const previous = room.get(playerId);
    room.set(playerId, socket);
    if (previous && previous !== socket) previous.close(CLOSE_REPLACED, 'Opened in another tab');
  }

  /** Removes the socket if it is still the player's current one. Returns whether it was. */
  unregister(roomCode: string, playerId: string, socket: WebSocket): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.get(playerId) !== socket) return false;
    room.delete(playerId);
    if (room.size === 0) this.rooms.delete(roomCode);
    return true;
  }

  broadcast(roomCode: string, message: ServerMessage): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const payload = JSON.stringify(message);
    for (const socket of room.values()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  closeAll(): void {
    for (const room of this.rooms.values()) {
      for (const socket of room.values()) socket.close(1001, 'Server shutting down');
    }
    this.rooms.clear();
  }
}

export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
