/**
 * Pet handlers — MCP-side surface for the creature engine.
 *
 * Distinct from `./pet/`, which is the Corvid-style creature engine
 * itself (drives, biochem, collection, ferret-shaped behavior). This
 * module is the dispatch surface: load + save the persisted state,
 * map MCP tool calls onto creature methods.
 *
 *  - loadCreature / saveCreature:  D1-backed state (re-)hydration
 *  - check / status:                snapshots
 *  - interact / play / give / nest: state-mutating MCP tools
 *  - tuck_in:                       gentle bedtime — tries to settle the creature
 *  - tick:                          cron-driven decay step
 *
 * `loadCreature` / `saveCreature` are exported because the worker's
 * `scheduled` cron handler in index.ts and several HTTP routes also
 * need direct access to creature state.
 */

import { Env } from './env';
import { Creature, CreatureState } from './pet';

export async function loadCreature(env: Env): Promise<Creature> {
  const row = await env.DB.prepare(
    `SELECT state_json FROM creature_state WHERE id = 'ember'`
  ).first() as any;

  if (row?.state_json) {
    try {
      const state: CreatureState = JSON.parse(row.state_json);
      return Creature.deserialize(state);
    } catch {
      // Corrupted state — fall through to fresh birth
    }
  }

  const creature = new Creature('Ember', 'ferret');
  await saveCreature(env, creature);
  return creature;
}

export async function saveCreature(env: Env, creature: Creature): Promise<void> {
  const state = creature.serialize();
  await env.DB.prepare(`
    INSERT INTO creature_state (id, name, species_id, state_json, last_tick_at, updated_at)
    VALUES ('ember', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      state_json = excluded.state_json,
      last_tick_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).bind(creature.name, creature.speciesId, JSON.stringify(state)).run();
}

export async function handlePetCheck(env: Env): Promise<string> {
  const creature = await loadCreature(env);
  const status = creature.status();
  const d = status.drives as Record<string, number>;

  let response = `${status.portrait}\n`;
  response += `Age: ${status.ageHours}h | Interactions: ${status.totalInteractions}\n`;
  response += `Hunger: ${d.hunger} | Energy: ${d.energy} | Trust: ${d.trust}\n`;
  response += `Happiness: ${d.happiness} | Loneliness: ${d.loneliness} | Boredom: ${d.boredom}\n`;
  if (status.collectionSize > 0) {
    response += `Stash: ${status.collectionSize} items (${status.treasuredCount} treasured)\n`;
  }
  if ((status.alerts as string[]).length > 0) {
    response += `⚠️ Alerts: ${(status.alerts as string[]).join(', ')}\n`;
  }
  response += `\nLast interaction: ${status.minutesSinceInteraction} min ago`;
  return response;
}

export async function handlePetStatus(env: Env): Promise<string> {
  const creature = await loadCreature(env);
  const status = creature.status();
  const chemistry = creature.biochem.getState();

  let response = `## ${status.portrait}\n\n`;
  response += `**Age:** ${status.ageHours}h | **Species:** ${status.species}\n`;
  response += `**Interactions:** ${status.totalInteractions} | **Sleeping:** ${status.isSleeping}\n\n`;
  response += `### Drives\n`;
  for (const [k, v] of Object.entries(status.drives as Record<string, number>)) {
    response += `${k}: ${v}\n`;
  }
  response += `\n### Chemistry\n`;
  for (const [k, v] of Object.entries(chemistry)) {
    response += `${k}: ${v}\n`;
  }
  response += `\n### Nest\n${status.nest}\n`;
  if ((status.alerts as string[]).length > 0) {
    response += `\n⚠️ **Alerts:** ${(status.alerts as string[]).join(', ')}`;
  }
  return response;
}

export async function handlePetInteract(env: Env, stimulus: string): Promise<string> {
  const creature = await loadCreature(env);
  const event = creature.interact(stimulus);
  await saveCreature(env, creature);
  return `${event.message}\n\nMood: ${event.mood}`;
}

export async function handlePetPlay(env: Env, params: Record<string, any>): Promise<string> {
  const creature = await loadCreature(env);
  const playType = params.type || ['chase', 'tunnel', 'wrestle', 'steal', 'hide'][Math.floor(Math.random() * 5)];
  const event = creature.playSpecific(playType);
  await saveCreature(env, creature);
  return `${event.message}\n\nMood: ${event.mood}`;
}

export async function handlePetGive(env: Env, params: Record<string, any>): Promise<string> {
  const creature = await loadCreature(env);
  const item = params.item || 'a mysterious thing';
  const event = creature.receiveGift(item, 'alex');
  await saveCreature(env, creature);
  return `${event.message}\n\nMood: ${event.mood}`;
}

export async function handlePetNest(env: Env): Promise<string> {
  const creature = await loadCreature(env);
  const inv = creature.collection.getInventory();
  if (inv.length === 0) return `${creature.name}'s stash is empty. Nothing collected yet.`;

  let response = `## ${creature.name}'s Stash (${inv.length} items)\n\n`;
  const treasured = inv.filter(t => t.treasured);
  const regular = inv.filter(t => !t.treasured);

  if (treasured.length > 0) {
    response += `### ⭐ Treasured\n`;
    for (const t of treasured) {
      response += `- "${t.content}" (${t.source}, sparkle: ${Math.round(t.sparkle * 100) / 100})\n`;
    }
  }
  if (regular.length > 0) {
    response += `\n### Stash\n`;
    for (const t of regular.slice(-10)) {
      response += `- "${t.content}" (${t.source}, sparkle: ${Math.round(t.sparkle * 100) / 100})\n`;
    }
    if (regular.length > 10) {
      response += `... and ${regular.length - 10} more items\n`;
    }
  }
  return response;
}

export async function handlePetTuckIn(env: Env): Promise<string> {
  const creature = await loadCreature(env);

  if (creature.isSleeping) {
    return `${creature.portrait()} is already sleeping. Let him rest. 💤`;
  }

  // Create sleep conditions — don't force it
  creature.biochem.chemicals.get('loneliness')?.adjust(-0.3);
  creature.biochem.chemicals.get('boredom')?.adjust(-0.2);
  creature.biochem.chemicals.get('adrenaline')?.adjust(-0.2);
  creature.biochem.chemicals.get('oxytocin')?.adjust(0.2);
  creature.biochem.chemicals.get('serotonin')?.adjust(0.15);

  const fatigue = creature.biochem.chemicals.get('fatigue')?.level ?? 0;

  if (fatigue > 0.4) {
    creature.isSleeping = true;
    await saveCreature(env, creature);
    return `You tuck ${creature.name} in gently. He does the ferret thing — goes completely limp, melts into the blanket like he has no bones. Out cold in seconds. 💤\n\nMood: ${creature.biochem.getMoodSummary()}`;
  }

  await saveCreature(env, creature);
  return `You tuck ${creature.name} in. He's calmer — loneliness and stress down, comfort up. But he's not quite tired enough to sleep yet. He's curled up in his blanket, one eye watching you. Give him time.\n\nMood: ${creature.biochem.getMoodSummary()}`;
}

export async function handlePetTick(env: Env): Promise<string> {
  const creature = await loadCreature(env);
  const events = creature.tick(1);
  await saveCreature(env, creature);

  if (events.length === 0) return `${creature.portrait()} — quiet tick.`;
  return events.map(e => e.message).join('\n') + `\n\nMood: ${creature.biochem.getMoodSummary()}`;
}
