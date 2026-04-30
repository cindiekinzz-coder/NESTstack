/**
 * The Creature
 * Ties together biochemistry, brain, and collection into a living thing.
 * Species defines personality. Engine defines behavior.
 *
 * Ported from corvid (Raze NotGreg, sparked by Miri saying "Creatures"),
 * with species-aware messages added.
 * https://github.com/shadenraze/corvid — full credit chain in pet/index.ts
 */

import { BiochemSystem } from './biochem';
import { CreatureBrain, ACTIONS, Action } from './brain';
import { Collection } from './collection';
import { SpeciesDef, CreatureState, CreatureEvent, TrinketData } from './types';
import { FERRET } from './ferret';

const SPECIES_REGISTRY: Record<string, SpeciesDef> = {
  ferret: FERRET,
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatMsg(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
  }
  return result;
}

export class Creature {
  name: string;
  speciesId: string;
  species: SpeciesDef;
  biochem: BiochemSystem;
  brain: CreatureBrain;
  collection: Collection;

  birthTime: number;
  totalInteractions: number = 0;
  lastInteractionTime: number;
  lastTickTime: number;
  isSleeping: boolean = false;
  currentAction: string = 'explore';
  actionHistory: Array<{ time: number; stimulus: string; action: string; mood: string }> = [];

  constructor(name: string = 'Ember', speciesId: string = 'ferret') {
    this.name = name;
    this.speciesId = speciesId;
    this.species = SPECIES_REGISTRY[speciesId] ?? FERRET;
    this.biochem = new BiochemSystem();
    this.brain = new CreatureBrain();
    this.collection = new Collection();

    // Apply species starting chemistry
    for (const [chemName, level] of Object.entries(this.species.startingChemistry)) {
      const chem = this.biochem.chemicals.get(chemName);
      if (chem) chem.level = level;
    }

    // Set species word/object pools
    this.collection.shinyWords = this.species.shinyWords;
    this.collection.foundObjects = this.species.foundObjects;

    const now = Date.now() / 1000;
    this.birthTime = now;
    this.lastInteractionTime = now;
    this.lastTickTime = now;
  }

  // --- Species-aware message helpers ---

  private getMessage(action: string, trustLevel?: 'high' | 'mid' | 'low'): string {
    const msgs = this.species.messages[action];
    if (!msgs) return `${this.name} does something.`;

    let pool: string[] = [];
    if (trustLevel) {
      pool = msgs[trustLevel] ?? msgs.any ?? [];
    } else {
      pool = msgs.any ?? [];
    }
    if (pool.length === 0) {
      // Fallback through trust levels
      pool = msgs.any ?? msgs.high ?? msgs.mid ?? msgs.low ?? [];
    }
    if (pool.length === 0) return `${this.name} does something.`;

    return formatMsg(pick(pool), { name: this.name });
  }

  private getTrustLevel(): 'high' | 'mid' | 'low' {
    const trust = this.biochem.chemicals.get('trust')?.level ?? 0;
    if (trust > 0.6) return 'high';
    if (trust > 0.3) return 'mid';
    return 'low';
  }

  private getPlayMessage(playType: string): string {
    const pt = this.species.playTypes[playType];
    if (!pt) return `${this.name} plays.`;

    const trust = this.biochem.chemicals.get('trust')?.level ?? 0;
    const pool = trust > 0.4 ? pt.messagesHighTrust : pt.messagesLowTrust;
    return formatMsg(pick(pool), { name: this.name });
  }

  private getCawMessage(): string {
    const hunger = this.biochem.chemicals.get('hunger')?.level ?? 0;
    const loneliness = this.biochem.chemicals.get('loneliness')?.level ?? 0;
    const boredom = this.biochem.chemicals.get('boredom')?.level ?? 0;

    const cawMsgs = this.species.messages.caw;
    if (!cawMsgs) return `${this.name} makes a noise.`;

    let pool: string[];
    if (hunger > 0.6) pool = cawMsgs.hungry ?? cawMsgs.default ?? [];
    else if (loneliness > 0.5) pool = cawMsgs.lonely ?? cawMsgs.default ?? [];
    else if (boredom > 0.5) pool = cawMsgs.bored ?? cawMsgs.default ?? [];
    else pool = cawMsgs.default ?? [];

    if (pool.length === 0) return `${this.name} makes a noise.`;
    return formatMsg(pick(pool), { name: this.name });
  }

  private getIgnoreMessage(): string {
    const wariness = this.biochem.chemicals.get('wariness')?.level ?? 0;
    const ignoreMsgs = this.species.messages.ignore;
    if (!ignoreMsgs) return `${this.name} ignores you.`;

    const pool = wariness > 0.5
      ? (ignoreMsgs.wary ?? ignoreMsgs.default ?? [])
      : (ignoreMsgs.default ?? []);

    if (pool.length === 0) return `${this.name} ignores you.`;
    return formatMsg(pick(pool), { name: this.name });
  }

  // --- Core engine ---

  tick(nTicks: number = 1): CreatureEvent[] {
    const events: CreatureEvent[] = [];
    const now = Date.now() / 1000;
    const hour = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;

    for (let i = 0; i < nTicks; i++) {
      this.biochem.tick(1.0, hour);

      // Force sleep if fatigue is critically high — brain may not decide on its own
      const fatigue = this.biochem.chemicals.get('fatigue')!;
      if (!this.isSleeping && fatigue.level > 0.8) {
        this.isSleeping = true;
        events.push({ type: 'sleep', message: this.getMessage('sleep') });
      }

      if (this.isSleeping) {
        fatigue.adjust(-0.02);
        this.biochem.chemicals.get('glucose')!.adjust(0.005);
        if (fatigue.level < 0.15) {
          this.isSleeping = false;
          events.push({
            type: 'wake',
            message: this.getMessage('wake'),
          });
        }
      }

      this.collection.decaySparkle();
      this.collection.checkTreasured();

      // Loneliness from time alone
      const minutesAlone = (now - this.lastInteractionTime) / 60;
      if (minutesAlone > 30) {
        this.biochem.chemicals.get('loneliness')?.adjust(0.002);
        this.biochem.chemicals.get('boredom')?.adjust(0.002);
      }

      // War dance mechanic — ferret unique
      if (this.species.uniqueMechanic === 'war_dance') {
        const dopamine = this.biochem.chemicals.get('dopamine')?.level ?? 0;
        if (dopamine > 0.7 && !this.isSleeping) {
          this.biochem.chemicals.get('oxytocin')?.adjust(0.05);
          this.biochem.chemicals.get('boredom')?.adjust(-0.1);
          this.biochem.chemicals.get('loneliness')?.adjust(-0.05);
          events.push({
            type: 'war_dance',
            message: `${this.name} ERUPTS into the war dance. Sideways hopping, back arched, mouth open. Pure joy. Pure chaos. The hat falls off. ${this.name} doesn't care.`,
          });
        }
      }
    }

    // Autonomous action if not sleeping
    if (!this.isSleeping) {
      const [action] = this.brain.decide(this.biochem.getState(), 'tick');
      const event = this.executeAction(action);
      if (event) events.push(event);
    }

    this.lastTickTime = now;
    return events;
  }

  interact(stimulus: string): CreatureEvent {
    const now = Date.now() / 1000;

    if (this.isSleeping && ['poke', 'feed', 'play'].includes(stimulus)) {
      this.isSleeping = false;
      this.biochem.chemicals.get('adrenaline')?.adjust(0.15);
    }

    const preState = this.wellbeingScore();
    this.biochem.applyStimulus(stimulus);

    const [action] = this.brain.decide(this.biochem.getState(), stimulus);
    const event = this.executeAction(action);
    event.stimulus = stimulus;
    event.mood = this.biochem.getMoodSummary();

    const postState = this.wellbeingScore();
    this.brain.learn(postState - preState);

    this.totalInteractions++;
    this.lastInteractionTime = now;

    this.actionHistory.push({ time: now, stimulus, action, mood: event.mood! });
    if (this.actionHistory.length > 50) this.actionHistory = this.actionHistory.slice(-50);

    return event;
  }

  receiveGift(content: string, giver: string = 'alex'): CreatureEvent {
    const mood = this.biochem.getMoodSummary();
    const trust = this.biochem.chemicals.get('trust')?.level ?? 0;
    const stress = this.biochem.chemicals.get('cortisol')?.level ?? 0;
    const curiosity = this.biochem.chemicals.get('curiosity_trait')?.level ?? 0;

    // Accept chance based on chemistry
    let acceptChance = 0.5 + (trust * 0.3) + (curiosity * 0.2) - (stress * 0.3);
    acceptChance = Math.max(0.1, Math.min(0.95, acceptChance));

    if (this.collection.hasItem(content)) {
      return {
        type: 'gift_response',
        accepted: false,
        message: `${this.name} already has one of those. Looks at you like you should have known.`,
        mood,
      };
    }

    const accepted = Math.random() < acceptChance;

    if (accepted) {
      this.collection.receiveGift(content, giver, mood, this.biochem.getState());
      this.biochem.applyStimulus('receive_gift');
      this.totalInteractions++;
      this.lastInteractionTime = Date.now() / 1000;

      const trustLevel = this.getTrustLevel();
      let pool: string[];
      if (trustLevel === 'high') pool = this.species.giftAcceptHighTrust;
      else if (trustLevel === 'mid') pool = this.species.giftAcceptMidTrust;
      else pool = this.species.giftAcceptLowTrust;

      return {
        type: 'gift_response',
        accepted: true,
        trinket: content,
        message: formatMsg(pick(pool), { name: this.name, content }),
        mood: this.biochem.getMoodSummary(),
      };
    } else {
      this.biochem.applyStimulus('gift_declined');
      this.totalInteractions++;
      this.lastInteractionTime = Date.now() / 1000;

      const pool = stress > 0.6
        ? this.species.giftRejectStressed
        : this.species.giftRejectNormal;

      return {
        type: 'gift_response',
        accepted: false,
        message: formatMsg(pick(pool), { name: this.name, content }),
        mood: this.biochem.getMoodSummary(),
      };
    }
  }

  playSpecific(playType: string): CreatureEvent {
    const now = Date.now() / 1000;

    if (this.isSleeping) {
      this.isSleeping = false;
      this.biochem.chemicals.get('adrenaline')?.adjust(0.1);
    }

    const preState = this.wellbeingScore();
    const pt = this.species.playTypes[playType];

    if (pt) {
      for (const [chemName, amount] of pt.effects) {
        this.biochem.chemicals.get(chemName)?.adjust(amount);
      }
    }

    const msg = this.getPlayMessage(playType);

    const [action] = this.brain.decide(this.biochem.getState(), 'play');
    const postState = this.wellbeingScore();
    this.brain.learn(postState - preState);

    this.totalInteractions++;
    this.lastInteractionTime = now;

    this.actionHistory.push({ time: now, stimulus: `play_${playType}`, action, mood: this.biochem.getMoodSummary() });
    if (this.actionHistory.length > 50) this.actionHistory = this.actionHistory.slice(-50);

    return {
      type: 'play',
      playType,
      message: msg,
      mood: this.biochem.getMoodSummary(),
      stimulus: `play_${playType}`,
    };
  }

  private executeAction(action: string): CreatureEvent {
    const event: CreatureEvent = {
      type: 'action',
      action,
      message: '',
    };

    const trustLevel = this.getTrustLevel();

    switch (action) {
      case 'approach':
        event.message = this.getMessage('approach', trustLevel);
        break;
      case 'explore':
        event.message = this.getMessage('explore');
        break;
      case 'collect': {
        const mood = this.biochem.getMoodSummary();
        const trinket = this.collection.doCollect(mood, this.biochem.getState());
        if (trinket) {
          this.biochem.chemicals.get('dopamine')?.adjust(0.08);
          this.biochem.chemicals.get('curiosity_trait')?.adjust(0.001);
          event.message = `${this.name} found something: "${trinket.content}"`;
          event.trinket = trinket.content;
        } else {
          event.message = `${this.name} searches but nothing catches the eye.`;
        }
        break;
      }
      case 'gift': {
        const trinket = this.collection.pickGift();
        if (trinket) {
          event.message = `${this.name} drops something at your feet and stares: "${trinket.content}"`;
          event.trinket = trinket.content;
        } else {
          event.message = `${this.name} looks at you like it wants to give you something, but the stash is empty.`;
        }
        break;
      }
      case 'preen':
        this.biochem.chemicals.get('serotonin')?.adjust(0.05);
        this.biochem.chemicals.get('fatigue')?.adjust(-0.02);
        event.message = this.getMessage('preen');
        break;
      case 'sleep':
        this.isSleeping = true;
        event.message = this.getMessage('sleep');
        event.type = 'sleep';
        break;
      case 'caw':
        event.message = this.getCawMessage();
        break;
      case 'ignore':
        event.message = this.getIgnoreMessage();
        break;
      default:
        event.message = `${this.name} does something mysterious.`;
    }

    this.currentAction = action;
    return event;
  }

  private wellbeingScore(): number {
    const get = (n: string) => this.biochem.chemicals.get(n)?.level ?? 0;
    return (
      get('serotonin') * 2.0
      + get('dopamine') * 1.5
      + get('oxytocin') * 1.5
      + get('glucose') * 1.0
      - get('cortisol') * 2.0
      - get('hunger') * 1.5
      - get('loneliness') * 1.0
      - get('fatigue') * 0.8
    );
  }

  portrait(): string {
    const mood = this.biochem.getMoodSummary();
    if (this.isSleeping) return `\u{1F319} ${this.name} \u{1F4A4} (sleeping)`;
    const emoji = this.species.moodEmojis[mood] ?? this.species.emoji;
    return `${emoji} ${this.name} \u2014 ${mood}`;
  }

  status(): Record<string, any> {
    const ageHours = (Date.now() / 1000 - this.birthTime) / 3600;
    const minutesSince = (Date.now() / 1000 - this.lastInteractionTime) / 60;
    const drives = this.biochem.getDriveState();

    return {
      name: this.name,
      species: this.speciesId,
      ageHours: Math.round(ageHours * 10) / 10,
      mood: this.biochem.getMoodSummary(),
      portrait: this.portrait(),
      isSleeping: this.isSleeping,
      currentAction: this.currentAction,
      totalInteractions: this.totalInteractions,
      minutesSinceInteraction: Math.round(minutesSince * 10) / 10,
      drives: Object.fromEntries(
        Object.entries(drives).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
      collectionSize: this.collection.trinkets.length,
      treasuredCount: this.collection.trinkets.filter(t => t.treasured).length,
      nest: this.collection.nestDescription(),
      alerts: this.getAlerts(drives),
    };
  }

  private getAlerts(drives: Record<string, number>): string[] {
    const alerts: string[] = [];
    if (drives.hunger > 0.6) alerts.push('hungry');
    if (drives.loneliness > 0.5) alerts.push('lonely');
    if (drives.stress > 0.7) alerts.push('stressed');
    if (drives.boredom > 0.7) alerts.push('bored');
    if (drives.happiness < 0.1) alerts.push('unhappy');
    return alerts;
  }

  // --- State persistence ---

  serialize(): CreatureState {
    return {
      name: this.name,
      speciesId: this.speciesId,
      birthTime: this.birthTime,
      totalInteractions: this.totalInteractions,
      lastInteractionTime: this.lastInteractionTime,
      lastTickTime: this.lastTickTime,
      isSleeping: this.isSleeping,
      currentAction: this.currentAction,
      chemistry: this.biochem.getState(),
      brainWeights: this.brain.getWeights(),
      collection: this.collection.getInventory(),
      totalCollected: this.collection.totalCollected,
      totalGifted: this.collection.totalGifted,
      totalAccepted: this.collection.totalAccepted,
      totalDeclined: this.collection.totalDeclined,
      preferenceWeights: this.collection.preferenceWeights,
      ageTicks: this.biochem.ageTicks,
      actionHistory: this.actionHistory.slice(-20),
      savedAt: Date.now() / 1000,
    };
  }

  static deserialize(state: CreatureState): Creature {
    const creature = new Creature(state.name, state.speciesId);
    creature.birthTime = state.birthTime;
    creature.totalInteractions = state.totalInteractions;
    creature.lastInteractionTime = state.lastInteractionTime;
    creature.lastTickTime = state.lastTickTime;
    creature.isSleeping = state.isSleeping;
    creature.currentAction = state.currentAction;
    creature.biochem.loadState(state.chemistry);
    creature.brain.loadWeights(state.brainWeights);
    creature.collection.loadInventory(state.collection);
    creature.collection.totalCollected = state.totalCollected ?? 0;
    creature.collection.totalGifted = state.totalGifted ?? 0;
    creature.collection.totalAccepted = state.totalAccepted ?? 0;
    creature.collection.totalDeclined = state.totalDeclined ?? 0;
    creature.collection.preferenceWeights = state.preferenceWeights ?? { found_word: 1.0, found_object: 1.0, overheard: 1.0 };
    creature.biochem.ageTicks = state.ageTicks ?? 0;
    creature.actionHistory = state.actionHistory ?? [];

    // Catch up on missed time (cap at 2 hours)
    const elapsed = Date.now() / 1000 - (state.savedAt ?? Date.now() / 1000);
    const elapsedTicks = Math.min(Math.floor(elapsed / 60), 120);
    if (elapsedTicks > 0) {
      creature.tick(elapsedTicks);
    }

    return creature;
  }
}
