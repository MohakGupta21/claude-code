# Snakes & Ladders Online

Real-time multiplayer Snakes & Ladders for 2–4 players. Create a room, share the code, and race to square 100.

- **Server-authoritative**: the browser only sends intents (`roll_dice`, `start`, …). Dice, movement, snakes, ladders, turns and wins are all decided on the server.
- **Durable**: SQLite is the source of truth. Games, players and full move history survive server restarts.
- **Real-time**: every player in a room gets state updates over WebSockets, with automatic reconnection.

## Quick start

Requires Node.js 22+.

```bash
npm install
npm run dev        # API/WebSocket server on :3000 + Vite dev server on :5173
```

Open http://localhost:5173. To try multiplayer on one machine, open a second tab (each tab is its own player) and join with the room code.

Production build:

```bash
npm run build      # builds the client into dist/client
npm start          # serves the client, API and WebSockets on :3000
```

| Script | Purpose |
| --- | --- |
| `npm test` | Engine, service (SQLite) and WebSocket integration tests |
| `npm run typecheck` | TypeScript type check for server, client and tests |

### Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `data/snakes.db` | SQLite database file (created automatically) |
| `RECONNECT_GRACE_MS` | `30000` | How long a disconnected player keeps a lobby seat, or their turn, before being removed or skipped |
| `START_COUNTDOWN_MS` | `3000` | Countdown between "Start" and the first turn |
| `HEARTBEAT_MS` | `15000` | WebSocket ping interval used to detect dead connections |

## How it works

```
Browser ──intent──▶ WebSocket ──▶ RoomManager ──▶ GameService ──▶ GameEngine (pure rules)
                                                     │
                                                     ▼
                                   SQLite (one transaction per action)
                                                     │
Browser ◀──state + events── broadcast to room ◀──────┘
```

```
shared/            Types, constants, board configs and the wire protocol, used by both sides
server/
  engine/          Pure, deterministic game rules (no I/O) — rollDice, movePlayer, applySnake, …
  game/            GameService (load → engine → persist, transactional) and RoomManager (broadcasts, timers)
  db/              SQLite connection, migrations and repository (parameterised SQL only)
  http/            REST API and static file serving
  ws/              WebSocket endpoint and connection registry
  validation.ts    Central validation of every client input
client/src/
  components/      Home, Lobby, Game screen, Board (SVG snakes & ladders), Dice, panels, overlays
  hooks/           Socket connection, animation queue, toasts, reduced motion
  lib/             API client, reconnecting socket, session storage, text helpers
tests/             Vitest suites
```

### Game rules

- 10×10 board with zig-zag numbering; tokens start off the board (square 0).
- Exact finish by default. `DEFAULT_RULES.finishRule` in `shared/constants.ts` also supports `bounce` and `overshoot`, and each game stores the rule it was created with.
- Snakes and ladders are data (`shared/boards.ts`). `validateBoard` rejects invalid layouts, such as a jump ending on another jump's start.
- The host starts once at least 2 players are in and everyone is ready. After a win, the host can start a rematch with the same players.

### API

| Method & path | Purpose |
| --- | --- |
| `POST /api/games` `{ name }` | Create a room. Returns `{ roomCode, playerId, token, state }` |
| `POST /api/games/:roomCode/join` `{ name }` | Join a room in the lobby |
| `GET /api/games/:roomCode` | Public game state |
| `GET /api/health` | Health check |
| `WS /ws/games/:roomCode` | Real-time channel |

WebSocket client messages: `join` / `reconnect` (with `playerId` and `token`, which must come first), `ready`, `start`, `roll_dice`, `restart`, `leave`.
Server messages: `welcome`, `state` (full state plus events such as `DICE_ROLLED`, `SNAKE_TRIGGERED` and `TURN_CHANGED`), `error`, `left`.

The player token is a random secret returned only to the joining player. Only its SHA-256 hash is stored.

### Database

Tables `games`, `players` and `moves`, managed by append-only migrations in `server/db/migrations.ts` (tracked in `schema_migrations`). Players who leave are soft-deleted (`left_at`), so move history stays intact. Each action is one `IMMEDIATE` transaction.

### Disconnections

A dropped player is marked disconnected and everyone is notified, but their state is kept. They are restored automatically when their tab reconnects, including after a page reload or a browser restart. If a player stays away past the grace period, they lose their lobby seat, or their turns are skipped during a game so the others can keep playing.
