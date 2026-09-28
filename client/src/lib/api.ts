import type { ErrorResponse, SessionResponse } from '../../../shared/protocol';
import type { GameState } from '../../../shared/types';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError('NETWORK', 'Could not reach the game server. Check your connection.');
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ErrorResponse>) | null;
  if (!res.ok || !body) {
    throw new ApiError(body?.error?.code ?? 'INTERNAL', body?.error?.message ?? 'Something went wrong. Please try again.');
  }
  return body;
}

export const api = {
  createGame: (name: string) =>
    request<SessionResponse>('/api/games', { method: 'POST', body: JSON.stringify({ name }) }),
  joinGame: (roomCode: string, name: string) =>
    request<SessionResponse>(`/api/games/${encodeURIComponent(roomCode)}/join`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  getGame: (roomCode: string) => request<{ state: GameState }>(`/api/games/${encodeURIComponent(roomCode)}`),
};
