export type Speed = 'slow' | 'normal' | 'fast' | 'off';

interface SpeedProfile {
  charDelay: number; // ms between ticks (base; jittered per tick)
  charsPerTick: number; // base chars per tick (varies ±)
  diffLineDelay: number; // ms between diff / output lines (base; jittered)
  /** Multiplier for the generator's pre-rolled "thinking" / tool-run pauses. */
  pauseScale: number;
}

const PROFILES: Record<Speed, SpeedProfile> = {
  slow: { charDelay: 55, charsPerTick: 2, diffLineDelay: 120, pauseScale: 1.5 },
  normal: { charDelay: 38, charsPerTick: 3, diffLineDelay: 90, pauseScale: 1 },
  fast: { charDelay: 18, charsPerTick: 5, diffLineDelay: 45, pauseScale: 0.45 },
  off: { charDelay: 0, charsPerTick: 9999, diffLineDelay: 0, pauseScale: 0 },
};

let currentSpeed: Speed = 'normal';

// Epoch-based cancellation: bumping the epoch aborts any in-flight animation
// at its next tick (used for the instant boss-mode switch).
let epoch = 0;
export function bumpEpoch() {
  epoch++;
}
export function epochNow() {
  return epoch;
}

export function setSpeed(s: string) {
  if (s === 'slow' || s === 'normal' || s === 'fast' || s === 'off') currentSpeed = s;
}

export function profile(): SpeedProfile {
  return PROFILES[currentSpeed];
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

/** Uniform random in [min, max]. */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** `ms` scaled by the speed profile with ±25% jitter, so no two pauses match. */
export function jittered(ms: number): number {
  const p = profile();
  if (p.pauseScale === 0 || ms <= 0) return 0;
  return Math.round(ms * p.pauseScale * rand(0.75, 1.25));
}

/**
 * Wait out a generator-provided pause (thinking before a step, a tool running).
 * Resolves early if the epoch moves on; returns false in that case.
 */
export async function pause(ms: number): Promise<boolean> {
  const myEpoch = epoch;
  const total = jittered(ms);
  if (total <= 0) return epoch === myEpoch;
  // Sleep in slices so a boss-mode switch isn't stuck behind a long fake test run.
  let left = total;
  while (left > 0) {
    if (epoch !== myEpoch) return false;
    const slice = Math.min(left, 120);
    await sleep(slice);
    left -= slice;
  }
  return epoch === myEpoch;
}

const SENTENCE_END = /[.!?。!?]\s*$/;
const CLAUSE_END = /[,;:，;:—]\s*$/;

/**
 * Stream text into an element with human-ish pacing: variable chunk sizes, jittered
 * tick delay, a beat after clauses and sentences, a longer one at line breaks, and
 * the occasional random stall. Calls onTick after each batch (for autoscroll).
 */
export async function typeInto(el: HTMLElement, text: string, onTick?: () => void): Promise<void> {
  const myEpoch = epoch;
  const p = profile();
  if (p.charDelay === 0) {
    el.textContent = (el.textContent ?? '') + text;
    onTick?.();
    return;
  }
  let i = 0;
  while (i < text.length) {
    if (epoch !== myEpoch) return;
    // Chunk size wanders between 1 and ~2× the base; tokens arrive in uneven bursts.
    const size = Math.max(1, Math.round(p.charsPerTick * rand(0.4, 2.1)));
    let next = text.slice(i, i + size);
    // Never split right after a newline; flush up to it so the pause lands on the break.
    const nl = next.indexOf('\n');
    if (nl >= 0 && nl < next.length - 1) next = next.slice(0, nl + 1);
    el.textContent = (el.textContent ?? '') + next;
    i += next.length;
    onTick?.();

    let delay = p.charDelay * rand(0.45, 1.7);
    if (next.endsWith('\n')) delay += rand(120, 420) * p.pauseScale;
    else if (SENTENCE_END.test(next)) delay += rand(90, 320) * p.pauseScale;
    else if (CLAUSE_END.test(next)) delay += rand(40, 160) * p.pauseScale;
    if (Math.random() < 0.025) delay += rand(250, 900) * p.pauseScale; // network-ish stall
    await sleep(delay);
  }
}

/** Reveal lines one at a time with jittered spacing. `render(line)` should append a DOM node. */
export async function revealLines<T>(items: T[], render: (item: T) => void, onTick?: () => void): Promise<void> {
  const myEpoch = epoch;
  const p = profile();
  for (let idx = 0; idx < items.length; idx++) {
    if (epoch !== myEpoch) return;
    render(items[idx]);
    onTick?.();
    if (p.diffLineDelay === 0) continue;
    // Tool output tends to arrive in bursts: short gaps with an occasional longer one.
    let delay = p.diffLineDelay * rand(0.3, 1.6);
    if (Math.random() < 0.12) delay += p.diffLineDelay * rand(2, 5);
    await sleep(delay);
  }
}
