import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_STATUS } from '../../../shared/constants';
import type { ServerMessage } from '../../../shared/protocol';
import { useGameAnimator } from '../hooks/useGameAnimator';
import { useGameConnection } from '../hooks/useGameConnection';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useToasts } from '../hooks/useToasts';
import { announce, describeEvent } from '../lib/describe';
import type { Session } from '../lib/session';
import { RoomHeader } from './common/RoomHeader';
import { Toasts } from './common/Toasts';
import { GameScreen } from './game/GameScreen';
import { Lobby } from './lobby/Lobby';

interface RoomProps {
  session: Session;
  /** Called when the player has left or can no longer play in this room. */
  onExit(notice?: string): void;
}

/** A player's view of one room: owns the socket, animation queue and notifications. */
export function Room({ session, onExit }: RoomProps) {
  const reducedMotion = useReducedMotion();
  const { view, enqueue, reset } = useGameAnimator(reducedMotion);
  const { toasts, push, dismiss } = useToasts();
  const [pendingRoll, setPendingRoll] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const leaving = useRef(false);
  /** Players seen dropping this session, so a first connection isn't announced as "is back". */
  const droppedPlayers = useRef(new Set<string>());
  const myId = session.playerId;

  const onMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case 'welcome':
          reset(message.state);
          setPendingRoll(false);
          break;
        case 'state':
          enqueue(message.state, message.events);
          for (const event of message.events) {
            if (event.type === 'DICE_ROLLED' && event.move.playerId === myId) setPendingRoll(false);
            if (event.type === 'PLAYER_DISCONNECTED') droppedPlayers.current.add(event.playerId);
            if (event.type === 'PLAYER_RECONNECTED' && !droppedPlayers.current.delete(event.playerId)) continue;
            const toast = describeEvent(event, myId);
            if (toast) push(toast.text, toast.tone);
          }
          setAnnouncement((prev) => announce(message.events, message.state, myId) ?? prev);
          break;
        case 'error':
          setPendingRoll(false);
          push(message.message, 'error');
          break;
        case 'left':
          onExit();
          break;
      }
    },
    [enqueue, reset, push, onExit, myId],
  );

  const { status, fatalError, send } = useGameConnection(session, { onMessage });

  useEffect(() => {
    if (fatalError && !leaving.current) onExit(fatalError);
  }, [fatalError, onExit]);

  const roll = useCallback(() => {
    if (send({ type: 'roll_dice' })) setPendingRoll(true);
    else push('Connection lost — trying to reconnect…', 'error');
  }, [send, push]);

  const leave = useCallback(() => {
    const state = view.state;
    const inProgress = state?.status === GAME_STATUS.PLAYING || state?.status === GAME_STATUS.STARTING;
    if (inProgress && !window.confirm('Leave this game? Your progress will be lost.')) return;
    leaving.current = true;
    // If the socket is down we still let the player go; the lobby grace period cleans up.
    if (!send({ type: 'leave' })) onExit();
  }, [send, onExit, view.state]);

  const state = view.state;
  return (
    <div className="room">
      <RoomHeader roomCode={session.roomCode} connection={status} onLeave={leave} />
      {status === 'reconnecting' && (
        <div className="connection-banner" role="alert">
          Connection lost — reconnecting…
        </div>
      )}
      <main className="room-main">
        {!state ? (
          <div className="loading" role="status">
            <span className="spinner" aria-hidden="true" /> Joining room…
          </div>
        ) : state.status === GAME_STATUS.WAITING ? (
          <Lobby
            state={state}
            myId={myId}
            connection={status}
            onReady={(ready) => send({ type: 'ready', ready })}
            onStart={() => send({ type: 'start' })}
          />
        ) : (
          <GameScreen
            state={state}
            view={view}
            myId={myId}
            connection={status}
            pendingRoll={pendingRoll}
            onRoll={roll}
            onPlayAgain={() => send({ type: 'restart' })}
            onLeave={leave}
          />
        )}
      </main>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
