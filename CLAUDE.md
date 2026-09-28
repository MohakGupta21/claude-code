# AGENTS.md

## Project: Multiplayer Snake & Ladders

Build a polished, production-quality **multiplayer Snake & Ladders web application** with an attractive modern UI, real-time multiplayer gameplay, and PostgreSQL persistence.

The application should feel like a real multiplayer game rather than a basic CRUD/demo application.

---

# 1. Product Goal

Create an online multiplayer Snake & Ladders game where players can:

* Create a game room.
* Join an existing game room.
* Play with multiple players.
* See other players' moves in real time.
* Roll dice.
* Move their token across the board.
* Automatically handle snakes and ladders.
* Know whose turn it is.
* See player status and positions.
* Finish the game when a player reaches the final square.
* Start a new game after completion.

The experience should be:

* Fun
* Responsive
* Visually polished
* Easy to understand
* Mobile-friendly
* Multiplayer-first
* Reliable under concurrent actions

---

# 2. Core Requirements

## Multiplayer

Support at least:

* 2 players
* 3 players
* 4 players

The architecture should allow increasing the player count later without major changes.

Players should be able to:

1. Create a room.
2. Receive a room/game code.
3. Share the code with other players.
4. Join the room.
5. Wait in the lobby until the host starts the game.
6. Play the game together.
7. See live updates from other players.

Do not require users to create an account unless authentication becomes necessary.

Use a lightweight player identity such as:

* Display name
* Unique player ID
* Player color/token

---

# 3. Game Rules

Implement standard Snake & Ladders rules.

## Board

Use a 10 × 10 board containing:

* 100 squares
* Snakes
* Ladders
* Clearly numbered cells
* Player tokens

The numbering should follow the traditional Snake & Ladders zig-zag pattern.

Example:

```text
100 99  98  97 ... 91
81  82  83  84 ... 90
80  79  78  77 ... 71
...
1   2   3   4  ... 10
```

## Dice

Each turn:

1. Player clicks "Roll Dice".
2. Generate a random value from 1–6.
3. Display an animated dice roll.
4. Move the player's token.
5. Check for snake/ladder.
6. If the player lands on a ladder, move them upward.
7. If the player lands on a snake, move them downward.
8. Update the game state.
9. Pass the turn to the next player.

The server/backend must be the source of truth for dice results and game state.

Do not trust client-generated dice results.

---

# 4. Winning Rules

A player wins when they reach square 100.

Prefer exact landing:

* If the player needs 4 spaces and rolls 4 → move to 100.
* If the player needs 4 spaces and rolls 5 → do not move.

Make this behavior configurable in the game engine so alternate rules can be added later.

When a player wins:

* Display a clear victory state.
* Show the winning player.
* Stop normal turn progression.
* Display a celebration animation.
* Allow players to start a new game.

---

# 5. Game State

The game state should contain at minimum:

```text
gameId
roomCode
status
players
currentPlayerId
winnerId
board
lastDiceRoll
turnNumber
createdAt
updatedAt
```

Each player should contain:

```text
id
name
color
position
isHost
isConnected
joinedAt
```

The server must validate all state-changing actions.

Clients must not be able to arbitrarily modify:

* Player position
* Current player
* Dice result
* Winner
* Game status

---

# 6. PostgreSQL Database

Use **PostgreSQL** as the persistent database.

The server connects using the `DATABASE_URL` environment variable (a standard Postgres connection string). Never hardcode connection strings or credentials in source code.

The database should store at minimum:

## games

```text
id
room_code
status
current_player_id
winner_id
created_at
updated_at
```

## players

```text
id
game_id
name
color
position
is_host
is_connected
created_at
updated_at
```

## moves

Store game history:

```text
id
game_id
player_id
dice_value
start_position
end_position
final_position
created_at
```

The `moves` table should allow the application to reconstruct or inspect the history of a game.

Use foreign keys and appropriate indexes.

---

# 7. Persistence

The game should survive application restarts where practical.

When a player reconnects:

* Restore their game state.
* Restore their position.
* Restore whose turn it is.
* Restore the current game status.

Do not rely exclusively on in-memory state.

PostgreSQL should be the durable source of game state.

---

# 8. Real-Time Multiplayer

Implement real-time synchronization.

Preferred approach:

* WebSockets

Alternative:

* Server-Sent Events
* Polling only if WebSockets are not practical for the chosen stack

When something happens, all connected players in the room should receive the update.

Examples:

```text
PLAYER_JOINED
PLAYER_LEFT
GAME_STARTED
DICE_ROLLED
PLAYER_MOVED
SNAKE_TRIGGERED
LADDER_TRIGGERED
TURN_CHANGED
GAME_WON
GAME_RESTARTED
```

Use a clean event-based architecture.

Example:

```text
Client
   ↓
WebSocket
   ↓
Game Server
   ↓
Game Engine
   ↓
PostgreSQL
   ↓
Broadcast updated state
   ↓
All clients
```

---

# 9. Server Authority

The backend must be authoritative.

For example:

### Bad

```text
Browser:
"I rolled a 6"
```

and the server trusts it.

### Good

```text
Browser:
"ROLL_DICE"

Server:
- Validate player turn
- Generate random number
- Calculate movement
- Apply snakes/ladders
- Persist move
- Update game state
- Broadcast result
```

All important game rules must be enforced server-side.

---

# 10. Lobby

Create an attractive multiplayer lobby.

The lobby should provide:

### Create Game

* Player name
* Create room button

### Join Game

* Player name
* Room code
* Join button

### Room Lobby

Display:

* Room code
* Players currently joined
* Player colors
* Host indicator
* Ready status
* Start Game button

The host should be able to start the game when the minimum number of players has joined.

---

# 11. Game UI

The main game screen should contain:

## Board

Large, visually appealing Snake & Ladders board.

Each square should have:

* Number
* Appropriate background
* Snake/ladder indicators where applicable
* Player tokens

## Player Panel

Display:

```text
Players

🔴 Mohak       Position: 42
🔵 Rahul       Position: 31
🟢 Amit        Position: 17
🟡 Priya       Position: 8
```

Clearly highlight the current player.

## Dice

Create an attractive animated dice component.

Show:

```text
Your Turn

[ 🎲 ROLL DICE ]
```

Disable the button when:

* It isn't the player's turn.
* The game is over.
* The player is disconnected.

## Game Information

Display:

* Current player
* Last dice roll
* Turn number
* Player positions
* Game status

---

# 12. Animations

The game should feel interactive.

Implement animations for:

* Dice rolling
* Player movement
* Token transitions
* Snake movement
* Ladder climbing
* Turn changes
* Player joining
* Player leaving
* Victory
* Game restart

Avoid excessive animation that makes the game slow or difficult to use.

Animations should be short and responsive.

---

# 13. Visual Design

The UI should be **beautiful and modern**.

Avoid a generic admin-dashboard appearance.

Use:

* Rounded cards
* Modern typography
* Soft shadows
* Smooth transitions
* Clear visual hierarchy
* Attractive game colors
* Good spacing
* Responsive layouts

The board should be the visual centerpiece.

Suggested aesthetic:

```text
Playful
Modern
Colorful
Premium
Game-like
```

Do not overuse gradients, glassmorphism, or excessive visual effects.

The UI should remain readable.

---

# 14. Responsive Design

The game must work on:

* Desktop
* Laptop
* Tablet
* Mobile

On mobile:

* Board should fit the screen.
* Player information should collapse appropriately.
* Dice controls should remain easily accessible.
* Avoid horizontal scrolling.
* Touch targets should be sufficiently large.

---

# 15. Game States

Clearly model the following states:

```text
WAITING
STARTING
PLAYING
FINISHED
ABANDONED
```

The UI should change based on game state.

---

# 16. Connection Handling

Handle WebSocket disconnections gracefully.

When a player disconnects:

* Mark them as disconnected.
* Inform other players.
* Preserve their game state.
* Allow reconnection.

Do not immediately delete a player because of a temporary network failure.

Consider a reconnection grace period.

---

# 17. Error Handling

Provide user-friendly errors.

Examples:

```text
Room not found
Room is full
Game has already started
It is not your turn
Invalid player
Connection lost
Game no longer exists
Invalid move
```

Never expose raw stack traces to users.

Log technical errors on the server.

---

# 18. Security

Validate all client inputs.

At minimum validate:

* Player names
* Room codes
* Player IDs
* Game IDs
* WebSocket messages
* Game actions

Prevent clients from:

* Moving themselves arbitrarily.
* Rolling for another player.
* Changing another player's position.
* Starting unauthorized games.
* Joining invalid rooms.
* Manipulating dice results.

Use parameterized SQL queries or an ORM.

Never construct SQL using raw user input.

---

# 19. Architecture

Keep the application modular.

Recommended separation:

```text
Frontend
├── Components
├── Pages
├── Game Board
├── Dice
├── Player Panel
├── Lobby
├── WebSocket client
└── State management

Backend
├── API
├── WebSocket server
├── Game engine
├── Room manager
├── Database layer
├── Models
└── Validation
```

The game rules should live in a dedicated game engine rather than inside UI components.

Example:

```text
GameEngine
├── rollDice()
├── movePlayer()
├── applySnake()
├── applyLadder()
├── validateMove()
├── nextTurn()
├── checkWinner()
└── restartGame()
```

---

# 20. API Design

Create clean APIs.

Possible endpoints:

```text
POST /api/games
POST /api/games/:roomCode/join
GET  /api/games/:roomCode
POST /api/games/:roomCode/start
POST /api/games/:roomCode/leave
```

WebSocket:

```text
/ws/games/:roomCode
```

WebSocket actions:

```text
join
ready
start
roll_dice
leave
reconnect
```

Do not create unnecessary endpoints when WebSockets are more appropriate.

---

# 21. Database Design Principles

Use migrations.

Do not manually modify the PostgreSQL database schema during development without updating the migration/schema definition.

Add indexes for frequently queried fields such as:

```text
games.room_code
players.game_id
moves.game_id
moves.player_id
```

Use transactions for operations that modify multiple related records.

For example, a dice roll should atomically:

1. Validate the turn.
2. Generate dice value.
3. Calculate movement.
4. Apply snake/ladder.
5. Update player position.
6. Insert move history.
7. Update game state.

Postgres allows concurrent transactions, so a transaction that changes a game must first lock that game's row (`SELECT … FOR UPDATE`) before reading the state it validates against. Otherwise two simultaneous actions (e.g. two joins, or a double-clicked roll) can both pass validation.

---

# 22. Testing

Write tests for the game engine.

At minimum test:

### Dice

* Values are between 1 and 6.

### Movement

* Player moves correctly.
* Player cannot move when it isn't their turn.
* Player cannot exceed square 100.

### Snakes

* Landing on snake head moves player down.

### Ladders

* Landing on ladder bottom moves player up.

### Winning

* Player wins at square 100.

### Turn management

* Turn changes correctly.
* Turn order remains consistent.

### Multiplayer

* Multiple players can join.
* Room capacity is enforced.
* State is synchronized.

### Reconnection

* Disconnected players can reconnect.
* Their position is preserved.

---

# 23. Code Quality

Write clean, maintainable code.

Prefer:

* Small functions
* Clear naming
* Strong typing where supported
* Reusable components
* Separation of concerns
* Centralized validation
* Centralized game rules

Avoid:

* Giant components
* Duplicate logic
* Hardcoded game state in UI
* Business logic inside presentation components
* Global mutable state unless necessary
* Magic numbers

Use constants/configuration for:

```text
BOARD_SIZE = 100
MIN_PLAYERS = 2
MAX_PLAYERS = 4
DICE_MIN = 1
DICE_MAX = 6
```

---

# 24. Development Workflow

Before implementing a major feature:

1. Inspect the existing project structure.
2. Understand the current architecture.
3. Reuse existing components/utilities where appropriate.
4. Implement the smallest coherent change.
5. Run tests.
6. Run lint/type checks.
7. Run the application.
8. Verify the feature manually.
9. Fix regressions before moving forward.

Do not rewrite working parts of the application unnecessarily.

---

# 25. UI/UX Requirements

The application should make the next action obvious.

For example:

### Player's turn

```text
Your Turn!

🎲 Roll the dice
```

### Another player's turn

```text
Rahul's Turn

Waiting for Rahul...
```

### Snake

```text
🐍 Oh no!

You landed on a snake.
42 → 17
```

### Ladder

```text
🪜 Great!

You found a ladder.
23 → 56
```

### Winner

```text
🏆 Mohak Wins!

Congratulations!

[ Play Again ]
```

---

# 26. Accessibility

Implement reasonable accessibility practices:

* Keyboard navigation
* Visible focus states
* Accessible buttons
* ARIA labels where appropriate
* Sufficient text contrast
* Don't rely solely on color to identify players
* Respect reduced-motion preferences where possible

---

# 27. Performance

Avoid unnecessary re-renders.

The game board should remain responsive during:

* Dice animation
* Player movement
* WebSocket updates
* Multiple players joining/leaving

Do not continuously poll the server if WebSockets are available.

---

# 28. Game Configuration

Keep board configuration separate from game logic.

Snakes and ladders should be represented as data.

Example:

```javascript
const snakes = {
  99: 54,
  70: 55,
  52: 42,
  25: 2
};

const ladders = {
  4: 25,
  13: 46,
  33: 49,
  42: 63
};
```

This should make it easy to create different boards later.

---

# 29. Future Extensibility

Structure the application so these features can be added later:

* Authentication
* Player profiles
* Leaderboards
* Match history
* Chat
* Spectator mode
* Private rooms
* Public matchmaking
* Different board themes
* Different Snake & Ladders configurations
* Sound effects
* Multiple game modes
* Rematch
* Player statistics

Do not implement these unless requested, but avoid architecture that makes them unnecessarily difficult.

---

# 30. Important Implementation Rules

### Rule 1 — Server is authoritative

Never trust the browser for game-critical state.

### Rule 2 — PostgreSQL is persistent state

Do not use an in-memory object as the only source of truth.

### Rule 3 — WebSockets synchronize state

All players in a room should see the same game state.

### Rule 4 — Game engine owns game rules

Do not duplicate Snake & Ladders rules between frontend and backend.

### Rule 5 — UI should reflect state

The frontend should render the current game state rather than independently calculating game outcomes.

### Rule 6 — Validate every state-changing request

Assume all client requests can be malicious or incorrect.

### Rule 7 — Keep components reusable

Avoid tightly coupling the board, dice, players, and networking logic.

---

# 31. Definition of Done

The implementation is considered complete when:

* [ ] Application starts successfully.
* [ ] PostgreSQL database initializes correctly (migrations run on startup).
* [ ] Users can create rooms.
* [ ] Users can join rooms using a room code.
* [ ] 2–4 players can participate.
* [ ] Lobby displays connected players.
* [ ] Host can start the game.
* [ ] Snake & Ladders board is rendered correctly.
* [ ] Dice works correctly.
* [ ] Dice results are generated server-side.
* [ ] Players move correctly.
* [ ] Snakes work.
* [ ] Ladders work.
* [ ] Turn management works.
* [ ] Winner detection works.
* [ ] Game state persists in PostgreSQL.
* [ ] Move history is stored.
* [ ] WebSocket synchronization works.
* [ ] Players see other players' moves in real time.
* [ ] Reconnection is handled.
* [ ] Invalid actions are rejected.
* [ ] Error states are user-friendly.
* [ ] UI is responsive.
* [ ] UI looks polished and game-like.
* [ ] No critical console errors.
* [ ] No critical server errors.
* [ ] Game engine has automated tests.
* [ ] Application can be restarted without corrupting game state.

---

# 32. Claude Code Instructions

When working on this project:

1. Read this `AGENTS.md` before making changes.
2. Inspect the repository before choosing an implementation.
3. Do not assume a framework or library that is not present.
4. Prefer the project's existing stack.
5. If the project is empty, choose a modern, simple stack suitable for a real-time multiplayer game.
6. Keep the frontend and backend responsibilities clearly separated.
7. Keep game rules deterministic and testable except for server-side dice generation.
8. Do not store secrets in source code.
9. Do not commit `.env` files containing secrets.
10. Do not introduce unnecessary dependencies.
11. Test changes before considering them complete.
12. Fix lint/type/test errors rather than ignoring them.
13. Preserve existing functionality when adding features.
14. Favor simple solutions over unnecessary abstractions.
15. Do not leave TODOs for core functionality.
16. Do not declare the project complete until the Definition of Done has been checked.

---

# 33. Final Product Standard

The final application should feel like a **real multiplayer game**.

A new user should be able to open the application and understand:

```text
What is this?
        ↓
Create or Join Game
        ↓
Enter Name
        ↓
Join Lobby
        ↓
Wait for Players
        ↓
Start Game
        ↓
Roll Dice
        ↓
Move
        ↓
Play With Friends
        ↓
Winner
        ↓
Play Again
```

Prioritize:

**Correct multiplayer synchronization > game correctness > reliability > UX > visual polish > additional features.**

Do not sacrifice game-state integrity for animations or visual effects.
