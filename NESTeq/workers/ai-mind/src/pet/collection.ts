/**
 * Collection System
 * Creatures collect shiny things. Words, fragments, objects.
 * Curated by chemistry, shaped by interaction, aged into treasure.
 *
 * Sparkle/treasure/trade mechanic from corvid (Raze NotGreg, sparked by Miri).
 * https://github.com/shadenraze/corvid — full credit chain in pet/index.ts
 */

import { TrinketData } from './types';

interface Trinket extends TrinketData {
  ageHours: number;
  isAncient: boolean;
  effectiveValue: number;
}

function makeTrinket(data: TrinketData): Trinket {
  const ageHours = (Date.now() / 1000 - data.collectedAt) / 3600;
  const isAncient = ageHours > 24;

  let effectiveValue = data.sparkle;
  if (data.treasured) effectiveValue += 0.5;
  if (data.accepted) effectiveValue += 0.3;
  if (data.declined) effectiveValue -= 0.2;
  if (ageHours > 48) effectiveValue += 0.1 * Math.min(ageHours / 48, 3.0);

  return { ...data, ageHours, isAncient, effectiveValue };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedChoice<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export class Collection {
  trinkets: TrinketData[] = [];
  maxItems: number = 50;
  totalCollected: number = 0;
  totalGifted: number = 0;
  totalAccepted: number = 0;
  totalDeclined: number = 0;
  preferenceWeights: Record<string, number> = {
    found_word: 1.0,
    found_object: 1.0,
    overheard: 1.0,
  };
  private collectedContent: Set<string> = new Set();

  shinyWords: string[] = [];
  foundObjects: string[] = [];

  private snapshotChems(chemState?: Record<string, number>): Record<string, number> {
    if (!chemState) return {};
    const keys = ['dopamine', 'oxytocin', 'serotonin', 'cortisol', 'curiosity_trait', 'loneliness', 'trust'];
    const snap: Record<string, number> = {};
    for (const k of keys) {
      if (k in chemState) snap[k] = Math.round(chemState[k] * 1000) / 1000;
    }
    return snap;
  }

  private add(trinket: TrinketData): TrinketData | null {
    if (this.trinkets.length >= this.maxItems) {
      const evictable = this.trinkets.filter(t => !t.treasured);
      if (evictable.length === 0) return null;

      const evictableTrinkets = evictable.map(makeTrinket);
      const least = evictableTrinkets.reduce((a, b) => a.effectiveValue < b.effectiveValue ? a : b);
      if (trinket.sparkle > least.effectiveValue) {
        const idx = this.trinkets.findIndex(t => t.content === least.content);
        if (idx >= 0) {
          this.collectedContent.delete(this.trinkets[idx].content);
          this.trinkets.splice(idx, 1);
        }
      } else {
        return null;
      }
    }

    this.trinkets.push(trinket);
    this.totalCollected++;
    this.collectedContent.add(trinket.content);
    return trinket;
  }

  collectWord(mood: string = 'neutral', chemState?: Record<string, number>): TrinketData | null {
    let available = this.shinyWords.filter(w => !this.collectedContent.has(w));
    if (available.length === 0) available = this.shinyWords;
    if (available.length === 0) return null;

    const word = pick(available);
    return this.add({
      content: word,
      source: 'found_word',
      collectedAt: Date.now() / 1000,
      timesShown: 0,
      sparkle: 1.0,
      moodWhenFound: mood,
      chemSnapshot: this.snapshotChems(chemState),
      treasured: false,
      accepted: false,
      declined: false,
    });
  }

  collectObject(mood: string = 'neutral', chemState?: Record<string, number>): TrinketData | null {
    let available = this.foundObjects.filter(o => !this.collectedContent.has(o));
    if (available.length === 0) available = this.foundObjects;
    if (available.length === 0) return null;

    const obj = pick(available);
    return this.add({
      content: obj,
      source: 'found_object',
      collectedAt: Date.now() / 1000,
      timesShown: 0,
      sparkle: 1.0,
      moodWhenFound: mood,
      chemSnapshot: this.snapshotChems(chemState),
      treasured: false,
      accepted: false,
      declined: false,
    });
  }

  receiveGift(content: string, giver: string = 'human', mood: string = 'neutral', chemState?: Record<string, number>): TrinketData | null {
    if (this.collectedContent.has(content)) return null;
    return this.add({
      content,
      source: `gift_from_${giver}`,
      collectedAt: Date.now() / 1000,
      timesShown: 0,
      sparkle: 1.5,
      moodWhenFound: mood,
      chemSnapshot: this.snapshotChems(chemState),
      treasured: false,
      accepted: false,
      declined: false,
    });
  }

  doCollect(mood: string = 'neutral', chemState?: Record<string, number>): TrinketData | null {
    const wordW = this.preferenceWeights.found_word ?? 1.0;
    const objW = this.preferenceWeights.found_object ?? 1.0;
    const wordProb = wordW / (wordW + objW);
    return Math.random() < wordProb
      ? this.collectWord(mood, chemState)
      : this.collectObject(mood, chemState);
  }

  pickGift(): TrinketData | null {
    if (this.trinkets.length === 0) return null;

    const trinkets = this.trinkets.map(makeTrinket);
    const weights = trinkets.map(t => {
      let w = t.effectiveValue / (1 + t.timesShown);
      w *= this.preferenceWeights[t.source] ?? 1.0;
      if (t.declined) w *= 0.1;
      return Math.max(w, 0.01);
    });

    const chosen = weightedChoice(this.trinkets, weights);
    chosen.timesShown++;
    chosen.sparkle *= 0.9;
    this.totalGifted++;
    return chosen;
  }

  pickTradeOffering(): TrinketData | null {
    let tradeable = this.trinkets.filter(t => !t.treasured);
    if (tradeable.length === 0) tradeable = [...this.trinkets];
    if (tradeable.length === 0) return null;

    const weights = tradeable.map(t => {
      const trinket = makeTrinket(t);
      let w = 1.0 / (0.5 + trinket.effectiveValue);
      if (t.declined) w *= 2.0;
      if (t.treasured) w *= 0.1;
      return Math.max(w, 0.01);
    });

    return weightedChoice(tradeable, weights);
  }

  evaluateTrade(offeringContent: string, givingUp: TrinketData, trust: number, curiosity: number, stress: number): boolean {
    if (this.collectedContent.has(offeringContent)) return false;

    let willingness = 0.4 + (trust * 0.25) + (curiosity * 0.25) - (stress * 0.2);
    const trinket = makeTrinket(givingUp);
    let attachment = trinket.effectiveValue;
    if (givingUp.treasured) attachment += 0.5;
    if (givingUp.accepted) attachment += 0.2;
    willingness -= attachment * 0.3;
    willingness += Math.min(offeringContent.length / 30.0, 0.3);
    willingness = Math.max(0.05, Math.min(0.95, willingness));
    return Math.random() < willingness;
  }

  decaySparkle(): void {
    for (const trinket of this.trinkets) {
      if (trinket.treasured) {
        trinket.sparkle = Math.max(trinket.sparkle, 0.5);
      } else {
        trinket.sparkle *= 0.999;
      }
    }
  }

  checkTreasured(): void {
    let treasuredCount = this.trinkets.filter(t => t.treasured).length;
    if (treasuredCount >= 10) return;

    for (const t of this.trinkets) {
      const trinket = makeTrinket(t);
      if (!t.treasured && trinket.isAncient) {
        if (t.accepted || t.sparkle > 0.5 || trinket.ageHours > 72) {
          t.treasured = true;
          treasuredCount++;
          if (treasuredCount >= 10) break;
        }
      }
    }
  }

  nestDescription(): string {
    if (this.trinkets.length === 0) return 'An empty stash. Nothing collected yet.';

    const n = this.trinkets.length;
    const trinkets = this.trinkets.map(makeTrinket);
    const shiniest = trinkets.reduce((a, b) => a.effectiveValue > b.effectiveValue ? a : b);
    const newest = trinkets.reduce((a, b) => a.collectedAt > b.collectedAt ? a : b);
    const treasured = trinkets.filter(t => t.treasured);

    const parts = [`A stash with ${n} items.`];
    if (treasured.length > 0) parts.push(`${treasured.length} treasured keepsakes.`);
    parts.push(`Most prized: "${shiniest.content}"`);
    parts.push(`Newest: "${newest.content}"`);
    return parts.join(' ');
  }

  getInventory(): TrinketData[] {
    return this.trinkets.map(t => ({ ...t }));
  }

  loadInventory(items: TrinketData[]): void {
    this.trinkets = items.map(t => ({ ...t }));
    this.collectedContent = new Set(this.trinkets.map(t => t.content));
  }

  hasItem(content: string): boolean {
    return this.collectedContent.has(content);
  }
}
