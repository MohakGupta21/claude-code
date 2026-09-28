import { BOARD_COLUMNS } from './constants';

export interface CellCoord {
  /** 0 = top row */
  row: number;
  /** 0 = left column */
  col: number;
}

/**
 * Position of a square on the traditional zig-zag board:
 * square 1 is bottom-left, rows alternate direction, and the last square is top-left
 * (for a 10-column board with an even number of rows).
 */
export function squareToCoord(square: number, size: number, columns = BOARD_COLUMNS): CellCoord {
  const rows = Math.ceil(size / columns);
  const index = square - 1;
  const rowFromBottom = Math.floor(index / columns);
  const offset = index % columns;
  const leftToRight = rowFromBottom % 2 === 0;
  return {
    row: rows - 1 - rowFromBottom,
    col: leftToRight ? offset : columns - 1 - offset,
  };
}

/** Squares in visual order: top row first, left to right. */
export function squaresInDisplayOrder(size: number, columns = BOARD_COLUMNS): number[] {
  const rows = Math.ceil(size / columns);
  const grid: number[] = new Array(rows * columns);
  for (let square = 1; square <= size; square++) {
    const { row, col } = squareToCoord(square, size, columns);
    grid[row * columns + col] = square;
  }
  return grid;
}
