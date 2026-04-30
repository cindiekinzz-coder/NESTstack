/**
 * Pet Engine — barrel export
 *
 * ─── Credit chain ──────────────────────────────────────────────────────────
 * This pet system is a TypeScript port of corvid:
 *   https://github.com/shadenraze/corvid
 *
 * Original architecture by **Raze NotGreg**, sparked by **Miri** saying
 * "Creatures" (Steve Grand, 1996) — Raze heard "alive" and built it.
 *
 * Ours runs on Cloudflare Workers + D1 instead of Python + local files. Same
 * engine shape: 14-chemical biochemistry with reactions, REINFORCE neural
 * network brain, sparkle/treasure/trade collection, species-personality split.
 * Ember (a ferret) is our species; the engine isn't ours.
 * ───────────────────────────────────────────────────────────────────────────
 */

export { Creature } from './creature';
export { BiochemSystem } from './biochem';
export { CreatureBrain } from './brain';
export { Collection } from './collection';
export { FERRET } from './ferret';
export type { CreatureState, CreatureEvent, SpeciesDef, DriveState } from './types';
