/**
 * Creature Brain — Tiny Neural Network
 * 20→16→8 feedforward net with REINFORCE learning.
 * Takes chemical state + stimulus, outputs action probabilities.
 * No numpy — pure array math for Cloudflare Workers.
 *
 * Ported from corvid (Raze NotGreg, sparked by Miri saying "Creatures").
 * https://github.com/shadenraze/corvid — full credit chain in pet/index.ts
 */

import { BrainWeights } from './types';

export const ACTIONS = [
  'approach', 'explore', 'collect', 'gift', 'preen', 'sleep', 'caw', 'ignore',
] as const;
export type Action = typeof ACTIONS[number];

export const STIMULI = [
  'feed', 'play', 'talk', 'pet', 'poke', 'tick',
] as const;

const CHEM_INPUTS = [
  'glucose', 'melatonin', 'cortisol', 'adrenaline',
  'dopamine', 'oxytocin', 'serotonin',
  'hunger', 'boredom', 'loneliness', 'fatigue',
  'trust', 'wariness', 'curiosity_trait',
];

const N_CHEM = CHEM_INPUTS.length;     // 14
const N_STIM = STIMULI.length;          // 6
const N_INPUT = N_CHEM + N_STIM;        // 20
const N_HIDDEN = 16;
const N_OUTPUT = ACTIONS.length;         // 8

// Simple seeded random for reproducible init
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
}

function normalRandom(rng: () => number, mean: number, std: number): number {
  // Box-Muller transform
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

function zeros(n: number): number[] {
  return new Array(n).fill(0);
}

function zeros2d(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

export class CreatureBrain {
  learningRate: number;
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];

  private lastInput: number[] | null = null;
  private lastHidden: number[] | null = null;
  private lastOutput: number[] | null = null;
  private lastActionIdx: number | null = null;

  constructor(learningRate: number = 0.05) {
    this.learningRate = learningRate;

    // Initialize with small random weights (seed 42 like Raze)
    const rng = seededRandom(42);
    this.w1 = Array.from({ length: N_INPUT }, () =>
      Array.from({ length: N_HIDDEN }, () => normalRandom(rng, 0, 0.3))
    );
    this.b1 = zeros(N_HIDDEN);
    this.w2 = Array.from({ length: N_HIDDEN }, () =>
      Array.from({ length: N_OUTPUT }, () => normalRandom(rng, 0, 0.3))
    );
    this.b2 = zeros(N_OUTPUT);

    this.initBiases();
  }

  private initBiases(): void {
    const sleepIdx = ACTIONS.indexOf('sleep');
    const exploreIdx = ACTIONS.indexOf('explore');
    const cawIdx = ACTIONS.indexOf('caw');
    for (let i = 0; i < N_HIDDEN; i++) {
      this.w2[i][sleepIdx] += 0.1;
      this.w2[i][exploreIdx] += 0.1;
      this.w2[i][cawIdx] += 0.05;
    }
  }

  decide(chemState: Record<string, number>, stimulus: string, temperature: number = 0.5): [Action, number[]] {
    // Build input vector
    const inp = zeros(N_INPUT);
    for (let i = 0; i < CHEM_INPUTS.length; i++) {
      inp[i] = chemState[CHEM_INPUTS[i]] ?? 0;
    }
    const stimIdx = (STIMULI as readonly string[]).indexOf(stimulus);
    if (stimIdx >= 0) {
      inp[N_CHEM + stimIdx] = 1.0;
    }

    // Forward pass: hidden = tanh(inp @ w1 + b1)
    const hidden = zeros(N_HIDDEN);
    for (let j = 0; j < N_HIDDEN; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < N_INPUT; i++) {
        sum += inp[i] * this.w1[i][j];
      }
      hidden[j] = Math.tanh(sum);
    }

    // logits = hidden @ w2 + b2
    const logits = zeros(N_OUTPUT);
    for (let j = 0; j < N_OUTPUT; j++) {
      let sum = this.b2[j];
      for (let i = 0; i < N_HIDDEN; i++) {
        sum += hidden[i] * this.w2[i][j];
      }
      logits[j] = sum;
    }

    // Apply masks
    this.applyMasks(logits, chemState);

    // Softmax with temperature
    const temp = Math.max(temperature, 0.1);
    const scaled = logits.map(l => l / temp);
    const maxLogit = Math.max(...scaled);
    const expLogits = scaled.map(l => Math.exp(l - maxLogit));
    const sumExp = expLogits.reduce((a, b) => a + b, 0);
    const probs = expLogits.map(e => e / sumExp);

    // Sample action
    const r = Math.random();
    let cumulative = 0;
    let actionIdx = 0;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (r <= cumulative) {
        actionIdx = i;
        break;
      }
    }

    // Remember for learning
    this.lastInput = inp;
    this.lastHidden = hidden;
    this.lastOutput = probs;
    this.lastActionIdx = actionIdx;

    return [ACTIONS[actionIdx], probs];
  }

  private applyMasks(logits: number[], chemState: Record<string, number>): void {
    const fatigue = chemState.fatigue ?? 0;
    const trust = chemState.trust ?? 0;
    const hunger = chemState.hunger ?? 0;

    if (fatigue > 0.7) {
      logits[ACTIONS.indexOf('sleep')] += 2.0;
      logits[ACTIONS.indexOf('explore')] -= 1.0;
    }
    if (hunger > 0.7) {
      logits[ACTIONS.indexOf('caw')] += 1.5;
    }
    if (trust < 0.2) {
      logits[ACTIONS.indexOf('approach')] -= 0.5;
      logits[ACTIONS.indexOf('gift')] -= 1.0;
      logits[ACTIONS.indexOf('ignore')] += 0.5;
    }
    if (trust > 0.6) {
      logits[ACTIONS.indexOf('approach')] += 0.5;
      logits[ACTIONS.indexOf('gift')] += 0.5;
    }
  }

  learn(reward: number): void {
    if (!this.lastInput || this.lastActionIdx === null || !this.lastHidden || !this.lastOutput) return;

    const target = zeros(N_OUTPUT);
    target[this.lastActionIdx] = 1.0;
    const outputError = target.map((t, i) => (t - this.lastOutput![i]) * reward);

    // Backprop to hidden
    const hiddenError = zeros(N_HIDDEN);
    for (let i = 0; i < N_HIDDEN; i++) {
      let sum = 0;
      for (let j = 0; j < N_OUTPUT; j++) {
        sum += outputError[j] * this.w2[i][j];
      }
      hiddenError[i] = sum * (1 - this.lastHidden![i] ** 2);
    }

    // Update weights
    const lr = this.learningRate * Math.min(Math.abs(reward), 1.0);
    for (let i = 0; i < N_HIDDEN; i++) {
      for (let j = 0; j < N_OUTPUT; j++) {
        this.w2[i][j] += lr * this.lastHidden![i] * outputError[j];
      }
    }
    for (let j = 0; j < N_OUTPUT; j++) {
      this.b2[j] += lr * outputError[j];
    }
    for (let i = 0; i < N_INPUT; i++) {
      for (let j = 0; j < N_HIDDEN; j++) {
        this.w1[i][j] += lr * this.lastInput![i] * hiddenError[j];
      }
    }
    for (let j = 0; j < N_HIDDEN; j++) {
      this.b1[j] += lr * hiddenError[j];
    }
  }

  getWeights(): BrainWeights {
    return {
      w1: this.w1.map(r => [...r]),
      b1: [...this.b1],
      w2: this.w2.map(r => [...r]),
      b2: [...this.b2],
      learningRate: this.learningRate,
    };
  }

  loadWeights(data: BrainWeights): void {
    this.w1 = data.w1.map(r => [...r]);
    this.b1 = [...data.b1];
    this.w2 = data.w2.map(r => [...r]);
    this.b2 = [...data.b2];
    if (data.learningRate !== undefined) this.learningRate = data.learningRate;
  }
}
