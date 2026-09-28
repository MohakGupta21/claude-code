import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '../../../shared/protocol';
import { GameSocket, type ConnectionStatus } from '../lib/socket';
import type { Session } from '../lib/session';

export interface ConnectionHandlers {
  onMessage(message: ServerMessage): void;
}

/** Owns the room's WebSocket for the lifetime of the component. */
export function useGameConnection(session: Session, handlers: ConnectionHandlers) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fatalError, setFatalError] = useState<string | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const socket = new GameSocket(session, {
      onMessage: (message) => handlersRef.current.onMessage(message),
      onStatus: setStatus,
      onFatal: setFatalError,
    });
    socketRef.current = socket;
    socket.connect();
    return () => socket.close();
  }, [session]);

  const send = useCallback((message: ClientMessage) => socketRef.current?.send(message) ?? false, []);

  return { status, fatalError, send };
}
