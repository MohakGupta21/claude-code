import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { GAME_STATUS } from '../shared/constants';
import type { ServerMessage, SessionResponse } from '../shared/protocol';
import type { GameState } from '../shared/types';
import { createApp, type App } from '../server/app';
import type { ServerConfig } from '../server/config';

let dir: string;
let app: App;
let baseUrl: string;
const clients: Client[] = [];

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: join(dir, 'mp.db'),
    clientDir: join(dir, 'client'),
    reconnectGraceMs: 200,
    startCountdownMs: 50,
    heartbeatMs: 60_000,
    ...overrides,
  };
}

async function start(overrides: Partial<ServerConfig> = {}) {
  app = createApp(config(overrides));
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'snl-mp-'));
  await start();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function post(path: string, body: unknown) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as SessionResponse & { error?: { code: string } } };
}

/** A test WebSocket client that records every message and can wait for a matching one. */
class Client {
  readonly messages: ServerMessage[] = [];
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  readonly ws: WebSocket;

  constructor(readonly session: SessionResponse) {
    this.ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws/games/${session.roomCode}`);
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(message)) return true;
        w.resolve(message);
        return false;
      });
    });
    clients.push(this);
  }

  async connect(): Promise<GameState> {
    await new Promise((resolve) => this.ws.once('open', resolve));
    this.send({ type: 'join', playerId: this.session.playerId, token: this.session.token });
    const welcome = await this.waitFor((m) => m.type === 'welcome');
    return (welcome as Extract<ServerMessage, { type: 'welcome' }>).state;
  }

  send(message: unknown) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(match: (m: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
    const existing = this.messages.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
      this.waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }

  waitForState(predicate: (s: GameState) => boolean) {
    return this.waitFor((m) => m.type === 'state' && predicate(m.state)).then(
      (m) => (m as Extract<ServerMessage, { type: 'state' }>).state,
    );
  }
}

async function twoPlayersPlaying() {
  const host = new Client((await post('/api/games', { name: 'Mohak' })).body);
  await host.connect();
  const guest = new Client((await post(`/api/games/${host.session.roomCode}/join`, { name: 'Rahul' })).body);
  await guest.connect();
  guest.send({ type: 'ready', ready: true });
  await host.waitForState((s) => s.players.every((p) => p.isReady));
  host.send({ type: 'start' });
  await Promise.all([
    host.waitForState((s) => s.status === GAME_STATUS.PLAYING),
    guest.waitForState((s) => s.status === GAME_STATUS.PLAYING),
  ]);
  return { host, guest };
}

describe('multiplayer over WebSockets', () => {
  it('broadcasts joins to the lobby', async () => {
    const host = new Client((await post('/api/games', { name: 'Mohak' })).body);
    await host.connect();
    await post(`/api/games/${host.session.roomCode}/join`, { name: 'Priya' });
    const state = await host.waitForState((s) => s.players.length === 2);
    expect(state.players.map((p) => p.name)).toEqual(['Mohak', 'Priya']);
    const joined = host.messages.find((m) => m.type === 'state' && m.events.some((e) => e.type === 'PLAYER_JOINED'));
    expect(joined).toBeDefined();
  });

  it('keeps every player in sync and rejects out-of-turn rolls', async () => {
    const { host, guest } = await twoPlayersPlaying();

    guest.send({ type: 'roll_dice' });
    const error = await guest.waitFor((m) => m.type === 'error');
    expect(error).toMatchObject({ code: 'NOT_YOUR_TURN', message: 'It is not your turn.' });

    host.send({ type: 'roll_dice' });
    const [hostView, guestView] = await Promise.all([
      host.waitForState((s) => s.lastDiceRoll !== null),
      guest.waitForState((s) => s.lastDiceRoll !== null),
    ]);
    expect(hostView).toEqual(guestView);
    expect(guestView.currentPlayerId).toBe(guest.session.playerId);
    expect(guestView.lastDiceRoll!.diceValue).toBeGreaterThanOrEqual(1);
    expect(guestView.lastDiceRoll!.diceValue).toBeLessThanOrEqual(6);
  });

  it('ignores client attempts to dictate outcomes', async () => {
    const { host } = await twoPlayersPlaying();
    host.send({ type: 'roll_dice', value: 6, position: 99 });
    const state = await host.waitForState((s) => s.lastDiceRoll !== null);
    expect(state.players.find((p) => p.id === host.session.playerId)!.position).toBeLessThan(99);
    host.send({ type: 'set_position', position: 100 });
    expect(await host.waitFor((m) => m.type === 'error')).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects sockets with a forged token', async () => {
    const host = new Client((await post('/api/games', { name: 'Mohak' })).body);
    const forged = new Client({ ...host.session, token: 'f'.repeat(64) });
    await new Promise((resolve) => forged.ws.once('open', resolve));
    forged.send({ type: 'join', playerId: host.session.playerId, token: forged.session.token });
    expect(await forged.waitFor((m) => m.type === 'error')).toMatchObject({ code: 'NOT_AUTHENTICATED' });
  });

  it('marks disconnected players and restores them on reconnect', async () => {
    const { host, guest } = await twoPlayersPlaying();
    host.send({ type: 'roll_dice' });
    await host.waitForState((s) => s.lastDiceRoll !== null);
    const position = (await guest.waitForState((s) => s.lastDiceRoll !== null)).players[0].position;

    host.ws.close();
    const away = await guest.waitForState((s) => s.players.some((p) => !p.isConnected));
    expect(away.players.find((p) => p.id === host.session.playerId)!.isConnected).toBe(false);

    const again = new Client(host.session);
    const restored = await again.connect();
    expect(restored.players.find((p) => p.id === host.session.playerId)).toMatchObject({ position, isConnected: true });
    expect(restored.currentPlayerId).toBe(guest.session.playerId);
  });

  it('skips the turn of a player who stays disconnected', async () => {
    const { host, guest } = await twoPlayersPlaying();
    host.ws.close();
    const state = await guest.waitForState((s) => s.currentPlayerId === guest.session.playerId);
    expect(state.turnNumber).toBe(2);
  });

  it('restores a game after the server restarts', async () => {
    const { host } = await twoPlayersPlaying();
    host.send({ type: 'roll_dice' });
    const before = await host.waitForState((s) => s.lastDiceRoll !== null);
    for (const c of clients.splice(0)) c.ws.close();
    await app.close();

    await start();
    const res = await fetch(`${baseUrl}/api/games/${before.roomCode}`);
    const { state } = (await res.json()) as { state: GameState };
    expect(state.status).toBe(GAME_STATUS.PLAYING);
    expect(state.players.map((p) => p.position)).toEqual(before.players.map((p) => p.position));
    expect(state.currentPlayerId).toBe(before.currentPlayerId);
    expect(state.players.every((p) => !p.isConnected)).toBe(true);
  });

  it('returns friendly HTTP errors', async () => {
    expect((await post('/api/games', { name: '' })).body.error?.code).toBe('INVALID_INPUT');
    expect((await post('/api/games/NOPE00/join', { name: 'x' })).status).toBe(404);
    const host = (await post('/api/games', { name: 'A' })).body;
    for (const name of ['B', 'C', 'D']) await post(`/api/games/${host.roomCode}/join`, { name });
    const full = await post(`/api/games/${host.roomCode}/join`, { name: 'E' });
    expect(full.status).toBe(409);
    expect(full.body.error).toEqual({ code: 'ROOM_FULL', message: 'This room is full.' });
  });
});
