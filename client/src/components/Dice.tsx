import { useEffect, useState } from 'react';
import { DICE_MAX, DICE_MIN } from '../../../shared/constants';
import './dice.css';

/** Pip positions on a 3×3 grid (0 = top-left … 8 = bottom-right). */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
const TUMBLE_FRAME_MS = 90;

const randomFace = () => DICE_MIN + Math.floor(Math.random() * (DICE_MAX - DICE_MIN + 1));

interface DiceProps {
  value: number | null;
  rolling: boolean;
}

/** Purely visual: while rolling it flickers through faces, then settles on the server's value. */
export function Dice({ value, rolling }: DiceProps) {
  const [face, setFace] = useState(value ?? DICE_MAX);

  useEffect(() => {
    if (!rolling) {
      if (value !== null) setFace(value);
      return;
    }
    const id = window.setInterval(() => setFace(randomFace()), TUMBLE_FRAME_MS);
    return () => window.clearInterval(id);
  }, [rolling, value]);

  const pips = PIPS[face] ?? [];
  return (
    <div
      className={`dice${rolling ? ' dice--rolling' : ''}${value === null && !rolling ? ' dice--idle' : ''}`}
      role="img"
      aria-label={rolling ? 'Dice rolling' : value ? `Dice showing ${value}` : 'Dice'}
    >
      {/* Keyed so the landing "pop" replays for each new result. */}
      <div key={rolling ? 'rolling' : `v${value}`} className="dice-face">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={pips.includes(i) ? 'pip' : 'pip pip--off'} />
        ))}
      </div>
    </div>
  );
}
