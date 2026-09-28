import { useCallback, useEffect, useState } from 'react';
import { ROOM_CODE_LENGTH } from '../../shared/constants';
import type { SessionResponse } from '../../shared/protocol';
import { HomePage } from './components/home/HomePage';
import { Room } from './components/Room';
import { clearSession, loadSession, saveSession, type Session } from './lib/session';

const ROOM_PATH = new RegExp(`^/room/([A-Za-z0-9]{${ROOM_CODE_LENGTH}})/?$`);

function roomCodeFromPath(): string | null {
  return ROOM_PATH.exec(location.pathname)?.[1].toUpperCase() ?? null;
}

/** Tiny path router: "/" is the home page, "/room/:code" is a room. */
export function App() {
  const [roomCode, setRoomCode] = useState(roomCodeFromPath);
  const [session, setSession] = useState<Session | null>(() => (roomCode ? loadSession(roomCode) : null));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => {
      const code = roomCodeFromPath();
      setRoomCode(code);
      setSession(code ? loadSession(code) : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const enterRoom = useCallback((response: SessionResponse) => {
    const next = { roomCode: response.roomCode, playerId: response.playerId, token: response.token };
    saveSession(next);
    history.pushState(null, '', `/room/${response.roomCode}`);
    setNotice(null);
    setRoomCode(response.roomCode);
    setSession(next);
  }, []);

  /** Leaving goes home; losing the session (e.g. removed from the lobby) offers to rejoin the same room. */
  const exitRoom = useCallback(
    (message?: string) => {
      if (roomCode) clearSession(roomCode);
      setSession(null);
      setNotice(message ?? null);
      if (!message) {
        history.pushState(null, '', '/');
        setRoomCode(null);
      }
    },
    [roomCode],
  );

  if (session) return <Room key={session.playerId} session={session} onExit={exitRoom} />;
  return <HomePage key={roomCode ?? 'home'} initialRoomCode={roomCode ?? undefined} notice={notice} onEnterRoom={enterRoom} />;
}
