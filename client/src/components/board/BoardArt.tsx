import { memo } from 'react';
import type { BoardConfig } from '../../../../shared/boards';
import { BOARD_COLUMNS } from '../../../../shared/constants';
import { rowsFor, smoothPath, snakePoints, squareCenter, type Point } from './geometry';

const SNAKE_COLORS = [
  { body: '#2fb679', stripe: '#bff5d8' },
  { body: '#8b5cf6', stripe: '#e3d6ff' },
  { body: '#f0642a', stripe: '#ffd9c2' },
  { body: '#0e9fb3', stripe: '#c5f1f7' },
  { body: '#e0457b', stripe: '#ffd1e1' },
];

/** Decorative SVG layer with the board's snakes and ladders, drawn from board data. */
export const BoardArt = memo(function BoardArt({ board }: { board: BoardConfig }) {
  const rows = rowsFor(board.size);
  const ladders = Object.entries(board.ladders).map(([from, to]) => [Number(from), to] as const);
  const snakes = Object.entries(board.snakes).map(([from, to]) => [Number(from), to] as const);
  return (
    <svg className="board-art" viewBox={`0 0 ${BOARD_COLUMNS} ${rows}`} aria-hidden="true">
      {ladders.map(([from, to]) => (
        <Ladder key={`l${from}`} bottom={squareCenter(from, board.size)} top={squareCenter(to, board.size)} />
      ))}
      {snakes.map(([from, to], i) => (
        <Snake
          key={`s${from}`}
          head={squareCenter(from, board.size)}
          tail={squareCenter(to, board.size)}
          seed={from}
          colors={SNAKE_COLORS[i % SNAKE_COLORS.length]}
        />
      ))}
    </svg>
  );
});

function Ladder({ bottom, top }: { bottom: Point; top: Point }) {
  const dx = top.x - bottom.x;
  const dy = top.y - bottom.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const half = 0.2;
  const nx = -uy * half;
  const ny = ux * half;
  const overhang = 0.12;
  const a = { x: bottom.x - ux * overhang, y: bottom.y - uy * overhang };
  const b = { x: top.x + ux * overhang, y: top.y + uy * overhang };
  const rungCount = Math.max(2, Math.floor(length / 0.42));
  const rungs = Array.from({ length: rungCount }, (_, i) => {
    const t = (i + 0.5) / rungCount;
    return { x: bottom.x + dx * t, y: bottom.y + dy * t };
  });
  return (
    <g className="ladder">
      <g transform="translate(0.06 0.08)" opacity="0.18">
        <line x1={a.x + nx} y1={a.y + ny} x2={b.x + nx} y2={b.y + ny} stroke="#000" strokeWidth="0.11" strokeLinecap="round" />
        <line x1={a.x - nx} y1={a.y - ny} x2={b.x - nx} y2={b.y - ny} stroke="#000" strokeWidth="0.11" strokeLinecap="round" />
      </g>
      {rungs.map((r, i) => (
        <line key={i} x1={r.x + nx} y1={r.y + ny} x2={r.x - nx} y2={r.y - ny} stroke="#c98a4b" strokeWidth="0.075" strokeLinecap="round" />
      ))}
      <line x1={a.x + nx} y1={a.y + ny} x2={b.x + nx} y2={b.y + ny} stroke="#8a5a2b" strokeWidth="0.1" strokeLinecap="round" />
      <line x1={a.x - nx} y1={a.y - ny} x2={b.x - nx} y2={b.y - ny} stroke="#8a5a2b" strokeWidth="0.1" strokeLinecap="round" />
    </g>
  );
}

function Snake({ head, tail, seed, colors }: { head: Point; tail: Point; seed: number; colors: { body: string; stripe: string } }) {
  const points = snakePoints(head, tail, seed);
  const d = smoothPath(points);
  const next = points[1];
  const angle = (Math.atan2(head.y - next.y, head.x - next.x) * 180) / Math.PI;
  return (
    <g className="snake">
      <path d={d} fill="none" stroke="#000" strokeOpacity="0.16" strokeWidth="0.36" strokeLinecap="round" transform="translate(0.06 0.08)" />
      <path d={d} fill="none" stroke="#1f2937" strokeOpacity="0.55" strokeWidth="0.36" strokeLinecap="round" />
      <path d={d} fill="none" stroke={colors.body} strokeWidth="0.29" strokeLinecap="round" />
      <path d={d} fill="none" stroke={colors.stripe} strokeWidth="0.1" strokeLinecap="round" strokeDasharray="0.07 0.22" />
      <g transform={`translate(${head.x} ${head.y}) rotate(${angle})`}>
        <path d="M 0.25 0 L 0.42 -0.05 M 0.25 0 L 0.42 0.05" stroke="#e11d48" strokeWidth="0.035" strokeLinecap="round" />
        <ellipse cx="0" cy="0" rx="0.28" ry="0.21" fill={colors.body} stroke="#1f2937" strokeOpacity="0.55" strokeWidth="0.035" />
        <circle cx="0.08" cy="-0.09" r="0.065" fill="#fff" />
        <circle cx="0.08" cy="0.09" r="0.065" fill="#fff" />
        <circle cx="0.1" cy="-0.09" r="0.032" fill="#111827" />
        <circle cx="0.1" cy="0.09" r="0.032" fill="#111827" />
      </g>
    </g>
  );
}
