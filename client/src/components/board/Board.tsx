import { memo, useMemo } from 'react';
import { squareToCoord, squaresInDisplayOrder } from '../../../../shared/boardLayout';
import type { BoardConfig } from '../../../../shared/boards';
import { BOARD_COLUMNS, START_POSITION } from '../../../../shared/constants';
import type { PlayerView } from '../../../../shared/types';
import type { TokenMotion } from '../../hooks/useGameAnimator';
import { COLOR_HEX, initial } from '../../lib/players';
import { BoardArt } from './BoardArt';
import { clusterOffset, rowsFor, START_STRIP_ROWS, tokenAnchor } from './geometry';
import './board.css';

interface BoardProps {
  board: BoardConfig;
  players: PlayerView[];
  positions: Record<string, number>;
  motion: TokenMotion;
  movingPlayerId: string | null;
  currentPlayerId: string | null;
  blockedPlayerId: string | null;
  myId: string;
  /** Overlay content (e.g. snake/ladder banner) drawn above the board. */
  children?: React.ReactNode;
}

export function Board(props: BoardProps) {
  const { board, players, positions, motion, movingPlayerId, currentPlayerId, blockedPlayerId, myId, children } = props;
  const rows = rowsFor(board.size);
  const totalRows = rows + START_STRIP_ROWS;
  const tokens = useMemo(() => layoutTokens(players, positions, board.size), [players, positions, board.size]);

  return (
    <div className="board-frame">
      <div
        className="board-surface"
        style={{ aspectRatio: `${BOARD_COLUMNS} / ${totalRows}`, '--grid-h': `${(rows / totalRows) * 100}%` } as React.CSSProperties}
      >
        <BoardCells board={board} layer="squares" />
        <BoardArt board={board} />
        <BoardCells board={board} layer="labels" />
        <div className="start-strip" style={{ height: `${(START_STRIP_ROWS / totalRows) * 100}%` }}>
          <span>Start</span>
        </div>
        <div className="token-layer" data-motion={motion}>
          {tokens.map(({ player, x, y, shared }) => (
            <div
              key={player.id}
              className={[
                'token',
                shared && 'token--shared',
                player.id === currentPlayerId && 'token--current',
                player.id === movingPlayerId && 'token--moving',
                player.id === blockedPlayerId && 'token--blocked',
                player.id === myId && 'token--mine',
                !player.isConnected && 'token--away',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                {
                  left: `${(x / BOARD_COLUMNS) * 100}%`,
                  top: `${(y / totalRows) * 100}%`,
                  '--token': COLOR_HEX[player.color],
                } as React.CSSProperties
              }
              aria-label={`${player.name}${player.id === myId ? ' (you)' : ''} on ${positionLabel(positions[player.id])}`}
              role="img"
            >
              {/* Keyed by position so the hop animation replays on every step. */}
              <span key={positions[player.id]} className="token-body">
                {initial(player.name)}
              </span>
            </div>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

function positionLabel(position: number | undefined) {
  return !position || position === START_POSITION ? 'the start' : `square ${position}`;
}

function layoutTokens(players: PlayerView[], positions: Record<string, number>, size: number) {
  const bySquare = new Map<number, PlayerView[]>();
  for (const p of players) {
    const pos = positions[p.id] ?? p.position;
    bySquare.set(pos, [...(bySquare.get(pos) ?? []), p]);
  }
  return players.map((player) => {
    const pos = positions[player.id] ?? player.position;
    const group = bySquare.get(pos)!;
    const index = group.indexOf(player);
    if (pos === START_POSITION) return { player, ...tokenAnchor(pos, size, index), shared: false };
    const anchor = tokenAnchor(pos, size, 0);
    const offset = clusterOffset(index, group.length);
    return { player, x: anchor.x + offset.x, y: anchor.y + offset.y, shared: group.length > 1 };
  });
}

const CELL_TINTS = ['#ffe3c2', '#d4f3e4', '#d8e7ff', '#ffdbe4', '#fff1b8'];

/**
 * The static grid, drawn twice: colored squares below the snake/ladder art and their labels above
 * it, so numbers stay readable. Memoised: it only changes if the board does.
 */
const BoardCells = memo(function BoardCells({ board, layer }: { board: BoardConfig; layer: 'squares' | 'labels' }) {
  const squares = squaresInDisplayOrder(board.size);
  if (layer === 'labels') {
    return (
      <div className="board-grid board-grid--labels" aria-hidden="true">
        {squares.map((square) => {
          const snakeTo = board.snakes[square];
          const ladderTo = board.ladders[square];
          return (
            <div key={square} className="cell-labels">
              <span className="cell-number">{square}</span>
              {snakeTo && <span className="cell-jump cell-jump--snake">↓{snakeTo}</span>}
              {ladderTo && <span className="cell-jump cell-jump--ladder">↑{ladderTo}</span>}
              {square === board.size && <span className="cell-crown">🏆</span>}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <ol className="board-grid" aria-label="Game board">
      {squares.map((square) => {
        const { row, col } = squareToCoord(square, board.size);
        const snakeTo = board.snakes[square];
        const ladderTo = board.ladders[square];
        const isFinish = square === board.size;
        const tint = (row + col) % 2 === 0 ? '#fffaf2' : CELL_TINTS[row % CELL_TINTS.length];
        const label = snakeTo
          ? `Square ${square}, snake down to ${snakeTo}`
          : ladderTo
            ? `Square ${square}, ladder up to ${ladderTo}`
            : isFinish
              ? `Square ${square}, finish`
              : `Square ${square}`;
        return (
          <li
            key={square}
            className={`cell${isFinish ? ' cell--finish' : ''}`}
            style={isFinish ? undefined : { background: tint }}
            aria-label={label}
          />
        );
      })}
    </ol>
  );
});
