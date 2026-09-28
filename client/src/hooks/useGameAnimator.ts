import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvent, GameState, JumpKind, MoveResult } from '../../../shared/types';

/**
 * Turns authoritative server updates into a paced visual sequence: dice tumble → token hops
 * square by square → snake/ladder slide → the new state is shown. It never computes outcomes;
 * every square it visits comes from the server's MoveResult.
 */

export type TokenMotion = 'step' | 'slide' | 'idle';

export interface JumpBanner {
  kind: JumpKind;
  playerId: string;
  from: number;
  to: number;
}

export interface AnimatedView {
  state: GameState | null;
  positions: Record<string, number>;
  motion: TokenMotion;
  movingPlayerId: string | null;
  dice: { value: number | null; rolling: boolean };
  banner: JumpBanner | null;
  blockedPlayerId: string | null;
  animating: boolean;
}

interface Timing {
  diceMs: number;
  stepMs: number;
  pauseMs: number;
  slideMs: number;
  bannerMs: number;
}

const FULL: Timing = { diceMs: 600, stepMs: 150, pauseMs: 220, slideMs: 750, bannerMs: 1500 };
const REDUCED: Timing = { diceMs: 0, stepMs: 0, pauseMs: 150, slideMs: 0, bannerMs: 1500 };
/** When updates pile up (e.g. returning to a background tab) skip straight to the latest state. */
const BACKLOG_LIMIT = 2;

const positionsOf = (state: GameState) => Object.fromEntries(state.players.map((p) => [p.id, p.position]));

function idleView(state: GameState | null): AnimatedView {
  return {
    state,
    positions: state ? positionsOf(state) : {},
    motion: 'idle',
    movingPlayerId: null,
    dice: { value: state?.lastDiceRoll?.diceValue ?? null, rolling: false },
    banner: null,
    blockedPlayerId: null,
    animating: false,
  };
}

/** Squares a token visits for a move, before any snake/ladder. */
function stepPath(move: MoveResult, boardSize: number): number[] {
  if (move.blocked) return [];
  const path: number[] = [];
  const peak = move.bounced ? boardSize : move.endPosition;
  for (let sq = move.startPosition + 1; sq <= peak; sq++) path.push(sq);
  if (move.bounced) for (let sq = boardSize - 1; sq >= move.endPosition; sq--) path.push(sq);
  return path;
}

export function useGameAnimator(reducedMotion: boolean) {
  const [view, setView] = useState<AnimatedView>(() => idleView(null));
  const queue = useRef<{ state: GameState; events: GameEvent[] }[]>([]);
  const running = useRef(false);
  const generation = useRef(0);
  const timing = reducedMotion ? REDUCED : FULL;
  const timingRef = useRef(timing);
  timingRef.current = timing;

  useEffect(() => () => void generation.current++, []);

  const process = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const gen = generation.current;
    const alive = () => gen === generation.current;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    while (queue.current.length > 0 && alive()) {
      const update = queue.current.shift()!;
      const rolled = update.events.find((e) => e.type === 'DICE_ROLLED');
      if (!rolled || queue.current.length >= BACKLOG_LIMIT) {
        setView(idleView(update.state));
        continue;
      }

      const { move } = rolled;
      const t = timingRef.current;
      const patch = (p: Partial<AnimatedView>) => setView((v) => ({ ...v, ...p }));

      patch({ animating: true, movingPlayerId: move.playerId, dice: { value: null, rolling: true } });
      if (t.diceMs) await wait(t.diceMs);
      patch({ dice: { value: move.diceValue, rolling: false } });
      await wait(t.pauseMs);
      if (!alive()) break;

      if (move.blocked) {
        patch({ blockedPlayerId: move.playerId });
        await wait(600);
        patch({ blockedPlayerId: null });
      }

      const path = t.stepMs ? stepPath(move, update.state.board.size) : [move.endPosition];
      for (const square of move.blocked ? [] : path) {
        if (!alive()) break;
        setView((v) => ({ ...v, motion: 'step', positions: { ...v.positions, [move.playerId]: square } }));
        await wait(t.stepMs || t.pauseMs);
      }

      if (move.jump && alive()) {
        patch({ banner: { kind: move.jump, playerId: move.playerId, from: move.endPosition, to: move.finalPosition } });
        await wait(t.pauseMs);
        setView((v) => ({ ...v, motion: 'slide', positions: { ...v.positions, [move.playerId]: move.finalPosition } }));
        await wait(Math.max(t.slideMs, t.bannerMs - t.pauseMs));
      }

      if (alive()) setView(idleView(update.state));
    }
    // A reset() while we were waiting starts a fresh loop; only the current loop may clear the flag.
    if (alive()) running.current = false;
  }, []);

  /** Queue an update from the server; animations play in order. */
  const enqueue = useCallback(
    (state: GameState, events: GameEvent[]) => {
      queue.current.push({ state, events });
      void process();
    },
    [process],
  );

  /** Jump straight to a state (initial load / reconnect), discarding pending animations. */
  const reset = useCallback((state: GameState) => {
    generation.current++;
    queue.current = [];
    running.current = false;
    setView(idleView(state));
  }, []);

  return { view, enqueue, reset };
}
