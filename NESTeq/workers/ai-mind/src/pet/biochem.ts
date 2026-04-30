/**
 * Biochemistry System
 * 14 interacting chemicals that produce emergent behavior through reactions.
 *
 * Ported from corvid (Raze NotGreg, sparked by Miri saying "Creatures").
 * https://github.com/shadenraze/corvid — full credit chain in pet/index.ts
 */

import { ChemicalDef, Reaction, DriveState } from './types';

class Chemical {
  name: string;
  level: number;
  decayRate: number;
  growthRate: number;
  min: number;
  max: number;

  constructor(def: ChemicalDef) {
    this.name = def.name;
    this.level = def.level;
    this.decayRate = def.decayRate;
    this.growthRate = def.growthRate;
    this.min = def.min;
    this.max = def.max;
  }

  tick(dt: number = 1.0): void {
    this.level += (this.growthRate - this.decayRate) * dt;
    this.level = Math.max(this.min, Math.min(this.max, this.level));
  }

  adjust(amount: number): void {
    this.level = Math.max(this.min, Math.min(this.max, this.level + amount));
  }
}

export class BiochemSystem {
  chemicals: Map<string, Chemical> = new Map();
  reactions: Reaction[] = [];
  ageTicks: number = 0;

  constructor() {
    this.initChemicals();
    this.initReactions();
  }

  private initChemicals(): void {
    const defs: ChemicalDef[] = [
      // Metabolic
      { name: 'glucose', level: 0.7, decayRate: 0.008, growthRate: 0.0, min: 0, max: 1 },
      { name: 'melatonin', level: 0.0, decayRate: 0.02, growthRate: 0.0, min: 0, max: 1 },
      // Stress / alertness
      { name: 'cortisol', level: 0.1, decayRate: 0.005, growthRate: 0.002, min: 0, max: 1 },
      { name: 'adrenaline', level: 0.0, decayRate: 0.04, growthRate: 0.0, min: 0, max: 1 },
      // Reward / bonding
      { name: 'dopamine', level: 0.3, decayRate: 0.015, growthRate: 0.0, min: 0, max: 1 },
      { name: 'oxytocin', level: 0.2, decayRate: 0.003, growthRate: 0.0, min: 0, max: 1 },
      { name: 'serotonin', level: 0.4, decayRate: 0.008, growthRate: 0.001, min: 0, max: 1 },
      // Drives
      { name: 'hunger', level: 0.2, decayRate: 0.0, growthRate: 0.006, min: 0, max: 1 },
      { name: 'boredom', level: 0.1, decayRate: 0.0, growthRate: 0.005, min: 0, max: 1 },
      { name: 'loneliness', level: 0.2, decayRate: 0.0, growthRate: 0.004, min: 0, max: 1 },
      { name: 'fatigue', level: 0.1, decayRate: 0.0, growthRate: 0.003, min: 0, max: 1 },
      // Personality
      { name: 'trust', level: 0.1, decayRate: 0.001, growthRate: 0.0, min: 0, max: 1 },
      { name: 'wariness', level: 0.2, decayRate: 0.001, growthRate: 0.0, min: 0, max: 1 },
      { name: 'curiosity_trait', level: 0.5, decayRate: 0.0005, growthRate: 0.001, min: 0, max: 1 },
    ];
    for (const def of defs) {
      this.chemicals.set(def.name, new Chemical(def));
    }
  }

  private initReactions(): void {
    this.reactions = [
      {
        name: 'hunger_stress',
        conditions: [['hunger', 0.6, true], ['glucose', 0.3, false]],
        effects: [['cortisol', 0.02]],
        rate: 1.0,
      },
      {
        name: 'stress_without_comfort',
        conditions: [['cortisol', 0.5, true], ['oxytocin', 0.3, false]],
        effects: [['wariness', 0.005], ['trust', -0.002]],
        rate: 1.0,
      },
      {
        name: 'safe_bonding',
        conditions: [['oxytocin', 0.4, true], ['cortisol', 0.3, false]],
        effects: [['trust', 0.003], ['wariness', -0.002]],
        rate: 1.0,
      },
      {
        name: 'boredom_to_curiosity',
        conditions: [['boredom', 0.5, true], ['glucose', 0.3, true]],
        effects: [['curiosity_trait', 0.002], ['boredom', -0.01]],
        rate: 1.0,
      },
      {
        name: 'exhaustion',
        conditions: [['fatigue', 0.7, true], ['melatonin', 0.5, true]],
        effects: [['serotonin', -0.02], ['cortisol', 0.01]],
        rate: 1.0,
      },
      {
        name: 'reward_cascade',
        conditions: [['dopamine', 0.5, true], ['serotonin', 0.4, true]],
        effects: [['cortisol', -0.02], ['boredom', -0.03]],
        rate: 1.0,
      },
      {
        name: 'lonely_bored',
        conditions: [['loneliness', 0.5, true], ['boredom', 0.5, true]],
        effects: [['cortisol', 0.015], ['serotonin', -0.01]],
        rate: 1.0,
      },
      {
        name: 'trust_amplifies_bonding',
        conditions: [['trust', 0.5, true], ['oxytocin', 0.3, true]],
        effects: [['oxytocin', 0.005], ['serotonin', 0.005]],
        rate: 1.0,
      },
      {
        name: 'wary_startle',
        conditions: [['wariness', 0.5, true], ['adrenaline', 0.3, true]],
        effects: [['cortisol', 0.03], ['adrenaline', 0.02]],
        rate: 1.0,
      },
    ];
  }

  tick(dt: number = 1.0, hourOfDay?: number): void {
    // Natural decay/growth
    for (const chem of this.chemicals.values()) {
      chem.tick(dt);
    }

    // Circadian rhythm
    if (hourOfDay !== undefined) {
      const melatoninTarget = Math.max(0, Math.sin((hourOfDay - 14) * Math.PI / 12)) * 0.8;
      const mel = this.chemicals.get('melatonin')!;
      mel.level += (melatoninTarget - mel.level) * 0.05 * dt;
    }

    // Run reactions
    for (const reaction of this.reactions) {
      if (this.checkConditions(reaction.conditions)) {
        for (const [chemName, amount] of reaction.effects) {
          const chem = this.chemicals.get(chemName);
          if (chem) chem.adjust(amount * reaction.rate * dt);
        }
      }
    }

    this.ageTicks++;
  }

  private checkConditions(conditions: Array<[string, number, boolean]>): boolean {
    for (const [chemName, threshold, above] of conditions) {
      const chem = this.chemicals.get(chemName);
      if (!chem) return false;
      if (above && chem.level < threshold) return false;
      if (!above && chem.level >= threshold) return false;
    }
    return true;
  }

  applyStimulus(stimulus: string): void {
    const effects: Record<string, Array<[string, number]>> = {
      feed: [['glucose', 0.3], ['hunger', -0.4], ['dopamine', 0.1], ['loneliness', -0.05]],
      play: [['dopamine', 0.2], ['boredom', -0.3], ['loneliness', -0.15], ['glucose', -0.05], ['fatigue', 0.05], ['oxytocin', 0.08]],
      talk: [['loneliness', -0.2], ['oxytocin', 0.06], ['boredom', -0.1], ['serotonin', 0.05]],
      pet: [['oxytocin', 0.15], ['cortisol', -0.1], ['loneliness', -0.2], ['serotonin', 0.08], ['wariness', -0.02]],
      poke: [['adrenaline', 0.2], ['cortisol', 0.1], ['boredom', -0.1], ['wariness', 0.03]],
      gift_accepted: [['dopamine', 0.15], ['oxytocin', 0.1], ['serotonin', 0.1], ['trust', 0.005]],
      gift_declined: [['cortisol', 0.05], ['dopamine', -0.05], ['wariness', 0.01]],
      receive_gift: [['dopamine', 0.15], ['oxytocin', 0.12], ['loneliness', -0.15], ['boredom', -0.2], ['trust', 0.003], ['curiosity_trait', 0.02]],
      trade_complete: [['dopamine', 0.2], ['oxytocin', 0.08], ['boredom', -0.25], ['trust', 0.006], ['curiosity_trait', 0.015], ['loneliness', -0.1]],
      trade_refused: [['wariness', 0.015], ['cortisol', 0.03]],
    };
    const fx = effects[stimulus];
    if (fx) {
      for (const [chemName, amount] of fx) {
        const chem = this.chemicals.get(chemName);
        if (chem) chem.adjust(amount);
      }
    }
  }

  getState(): Record<string, number> {
    const state: Record<string, number> = {};
    for (const [name, chem] of this.chemicals) {
      state[name] = Math.round(chem.level * 10000) / 10000;
    }
    return state;
  }

  getDriveState(): DriveState {
    const get = (n: string) => this.chemicals.get(n)?.level ?? 0;
    return {
      hunger: get('hunger'),
      boredom: get('boredom'),
      loneliness: get('loneliness'),
      fatigue: get('fatigue'),
      stress: get('cortisol'),
      happiness: get('serotonin'),
      energy: 1.0 - get('fatigue'),
      curiosity: get('curiosity_trait'),
      trust: get('trust'),
      wariness: get('wariness'),
    };
  }

  loadState(state: Record<string, number>): void {
    for (const [name, level] of Object.entries(state)) {
      const chem = this.chemicals.get(name);
      if (chem) chem.level = level;
    }
  }

  getMoodSummary(): string {
    const d = this.getDriveState();
    if (d.fatigue > 0.7) return 'exhausted';
    if (d.hunger > 0.7) return 'ravenous';
    if (d.stress > 0.6 && d.trust < 0.3) return 'agitated';
    if (d.loneliness > 0.6) return 'lonely';
    if (d.boredom > 0.6 && d.energy > 0.4) return 'restless';
    if (d.happiness > 0.6 && d.trust > 0.5) return 'content';
    if (d.happiness > 0.5) return 'calm';
    if (d.curiosity > 0.6 && d.energy > 0.5) return 'curious';
    if (d.wariness > 0.5) return 'wary';
    if (d.fatigue > 0.5) return 'drowsy';
    return 'neutral';
  }
}
