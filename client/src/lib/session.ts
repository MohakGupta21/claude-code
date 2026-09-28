/**
 * Player credentials for a room. Kept per-tab in sessionStorage (so several tabs can be different
 * players) and mirrored to localStorage so closing and reopening the browser can resume the game.
 */
export interface Session {
  roomCode: string;
  playerId: string;
  token: string;
}

const key = (roomCode: string) => `snl.session.${roomCode}`;
const NAME_KEY = 'snl.name';

function read(storage: Storage, k: string): string | null {
  try {
    return storage.getItem(k);
  } catch {
    return null;
  }
}

function write(storage: Storage, k: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(k);
    else storage.setItem(k, value);
  } catch {
    // Storage may be unavailable (private mode); the game still works for this tab.
  }
}

export function loadSession(roomCode: string): Session | null {
  const raw = read(sessionStorage, key(roomCode)) ?? read(localStorage, key(roomCode));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    return session.roomCode === roomCode && session.playerId && session.token ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  const value = JSON.stringify(session);
  write(sessionStorage, key(session.roomCode), value);
  write(localStorage, key(session.roomCode), value);
}

export function clearSession(roomCode: string): void {
  write(sessionStorage, key(roomCode), null);
  write(localStorage, key(roomCode), null);
}

export const rememberedName = {
  get: () => read(localStorage, NAME_KEY) ?? '',
  set: (name: string) => write(localStorage, NAME_KEY, name),
};
