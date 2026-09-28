import { squareToCoord } from '../../../../shared/boardLayout';
import { BOARD_COLUMNS, START_POSITION } from '../../../../shared/constants';

/** Board drawing geometry, in "cell units" (one cell = 1 × 1). */

/** Extra rows below the grid for the start strip where tokens wait before entering the board. */
export const START_STRIP_ROWS = 0.8;

export interface Point {
  x: number;
  y: number;
}

export function rowsFor(size: number): number {
  return Math.ceil(size / BOARD_COLUMNS);
}

/** Center of a square in cell units. */
export function squareCenter(square: number, size: number): Point {
  const { row, col } = squareToCoord(square, size);
  return { x: col + 0.5, y: row + 0.5 };
}

/** Where a token sits: on its square, or in the start strip for tokens not yet on the board. */
export function tokenAnchor(position: number, size: number, startSlot: number): Point {
  if (position === START_POSITION) {
    return { x: 0.55 + startSlot * 0.75, y: rowsFor(size) + START_STRIP_ROWS / 2 };
  }
  return squareCenter(position, size);
}

/** Offsets that fan out tokens sharing a square so they stay visible. */
export function clusterOffset(index: number, count: number): Point {
  if (count <= 1) return { x: 0, y: 0 };
  if (count === 2) return { x: index === 0 ? -0.2 : 0.2, y: 0 };
  const d = 0.19;
  return [
    { x: -d, y: -d },
    { x: d, y: -d },
    { x: -d, y: d },
    { x: d, y: d },
    { x: 0, y: 0 },
    { x: 0, y: -d * 1.6 },
  ][index % 6];
}

/** Catmull-Rom spline through points, as an SVG path of cubic Béziers. */
export function smoothPath(points: Point[]): string {
  if (points.length < 2) return '';
  const f = (n: number) => n.toFixed(3);
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** A wavy line from head to tail, used for a snake's body. */
export function snakePoints(head: Point, tail: Point, seed: number): Point[] {
  const dx = tail.x - head.x;
  const dy = tail.y - head.y;
  const length = Math.hypot(dx, dy);
  const nx = -dy / length;
  const ny = dx / length;
  const waves = Math.max(1, Math.round(length / 2.6));
  const amplitude = Math.min(0.42, 0.18 + length * 0.04) * (seed % 2 === 0 ? 1 : -1);
  const samples = Math.max(12, Math.round(length * 6));
  const points: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const envelope = Math.sin(Math.PI * t) ** 0.7;
    const offset = amplitude * envelope * Math.sin(t * Math.PI * 2 * waves);
    points.push({ x: head.x + dx * t + nx * offset, y: head.y + dy * t + ny * offset });
  }
  return points;
}
