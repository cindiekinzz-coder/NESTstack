/**
 * Ferret — The Chaos Noodle
 * Manic, affectionate, zero impulse control. Steals everything.
 * War-dances when happy. Sleeps like the dead. Wakes up choosing violence.
 *
 * The species file is ours (Ember). The engine underneath (biochem, brain,
 * collection) is from corvid (Raze NotGreg / Miri). Same shape as corvid's
 * fox.py / cat.py / serpent.py / moth.py — species-personality on top of
 * shared engine. https://github.com/shadenraze/corvid
 */

import { SpeciesDef } from './types';

export const FERRET: SpeciesDef = {
  id: 'ferret',
  displayName: 'Ferret',
  emoji: '\u{1F9A6}',
  description: 'Manic, affectionate, zero impulse control. Steals everything. War-dances when happy. Sleeps like the dead.',

  startingChemistry: {
    glucose: 0.8,
    cortisol: 0.05,
    dopamine: 0.6,
    oxytocin: 0.35,
    serotonin: 0.45,
    hunger: 0.25,
    boredom: 0.3,
    loneliness: 0.1,
    fatigue: 0.05,
    trust: 0.3,
    wariness: 0.08,
    curiosity_trait: 0.8,
  },

  moodEmojis: {
    content: '\u{1F49C}',
    calm: '\u{1F634}',
    curious: '\u{1F443}',
    restless: '\u26A1',
    lonely: '\u{1F97A}',
    exhausted: '\u{1FAE0}',
    ravenous: '\u{1F356}',
    agitated: '\u{1FAE8}',
    wary: '\u{1F440}',
    drowsy: '\u{1F319}',
  },

  messages: {
    approach: {
      high: [
        '{name} launches at you like a furry missile. HELLO. HELLO. HI.',
        '{name} climbs your leg, your torso, your shoulder. Claims the top of your head. Victory.',
        '{name} does the full-body wag. Not just the tail. The ENTIRE noodle vibrates.',
        '{name} brings you a sock. It\'s your sock. From the drawer. The closed drawer.',
      ],
      mid: [
        '{name} does a cautious dook and slinks closer, belly low.',
        '{name} bumps your ankle with its nose and retreats. Checking the vibe.',
        '{name} circles your feet in increasingly tight spirals.',
      ],
      low: [
        '{name} peeks out from behind something. One eye. Assessing.',
        '{name} stretches toward you without actually moving closer. Suspicious noodle.',
        '{name} sniffs the air in your direction. Jury\'s still out.',
      ],
    },
    explore: {
      any: [
        '{name} disappears into a gap you didn\'t know existed. Concerning sounds follow.',
        '{name} sticks its entire head into your bag. Emerges with something. Runs.',
        '{name} investigates the back of the couch with the intensity of a crime scene detective.',
        '{name} found a tunnel. There is no tunnel. It made one.',
        '{name} speed-checks every corner of the room in four seconds flat.',
        '{name} climbs something it shouldn\'t, gets stuck, acts like this was the plan.',
        '{name} opens a drawer. HOW. It doesn\'t have thumbs.',
      ],
    },
    preen: {
      any: [
        '{name} grooms itself with aggressive efficiency. Three seconds. Done. Chaos resumes.',
        '{name} does the ferret stretch \u2014 impossibly long, impossibly flat.',
        '{name} scratches behind its ear with a back foot. Falls over. Resumes scratching.',
        '{name} licks its own belly for exactly two seconds then forgets what it was doing.',
      ],
    },
    caw: {
      hungry: [
        '{name} dooks urgently at the food spot. Then at you. Then back. FOOD.',
        '{name} drags its empty bowl toward you. Pointed.',
      ],
      lonely: [
        '{name} makes soft dooking sounds. Hey. Hey. Where\'d you go. Hey.',
        '{name} stands on its hind legs and paws at the air in your direction. Notice me.',
      ],
      bored: [
        '{name} knocks something off a surface. Makes eye contact. Knocks something else off.',
        '{name} starts digging at the carpet. Not going anywhere. Just expressing displeasure.',
        '{name} war-dances at nothing. Pure, directionless chaos energy.',
      ],
      default: [
        '{name} dooks once. Just a dook. A little announcement.',
        '{name} makes the happy chatter noise. No reason. Good day.',
      ],
    },
    ignore: {
      wary: [
        '{name} retreats to the back of its hammock. Small. Quiet. Not playing.',
        '{name} goes boneless behind the couch. Refuses to acknowledge your existence.',
      ],
      default: [
        '{name} is VERY busy with something inside the couch cushion.',
        '{name} has found something more interesting than you. It\'s a dust bunny. But still.',
        '{name} walks away mid-interaction. Attention span: spent.',
        '{name} pretends to be asleep. One eye is slightly open. It\'s not asleep.',
      ],
    },
    sleep: {
      any: [
        '{name} goes completely limp. Dead ferret sleep. You could pick it up like a wet noodle and it would not care.',
        '{name} curls into an impossibly small ball in its hammock. Gone. Unreachable.',
      ],
    },
    wake: {
      any: [
        '{name} goes from dead asleep to full speed in 0.2 seconds. No warmup. Pure violence.',
        '{name} yawns, stretches, and immediately starts looking for trouble.',
      ],
    },
  },

  playTypes: {
    chase: {
      name: 'chase',
      effects: [['dopamine', 0.35], ['boredom', -0.45], ['loneliness', -0.2],
               ['glucose', -0.12], ['fatigue', 0.12], ['adrenaline', 0.15]],
      messagesHighTrust: [
        '{name} does the WAR DANCE. Sideways hop. Sideways hop. CHARGE. Miss. Slam into wall. Do it again.',
        '{name} bounces off three surfaces and lands on your foot. Tag. You\'re it.',
        '{name} runs backward while making eye contact. How is it not hitting things. It\'s hitting things.',
      ],
      messagesLowTrust: [
        '{name} does a tentative sideways hop. Was that... was that fun? It might have been fun.',
        '{name} runs, stops, looks back. Runs again. This might be a game or an escape plan.',
      ],
    },
    tunnel: {
      name: 'tunnel',
      effects: [['dopamine', 0.25], ['curiosity_trait', 0.04], ['boredom', -0.4],
               ['loneliness', -0.1], ['serotonin', 0.08], ['fatigue', 0.06]],
      messagesHighTrust: [
        '{name} disappears into the tunnel. Sounds of frantic scrabbling. Emerges from the other end with a sock.',
        '{name} dives into every tube, box, and sleeve in reach. Speed-tunneling. A blur of fur.',
        '{name} builds a nest inside the tunnel out of stolen things. Sets up camp. This is home now.',
      ],
      messagesLowTrust: [
        '{name} enters the tunnel cautiously. Pauses. Reverses out. Goes back in. Repeat.',
        '{name} watches the tunnel from outside. Puts one paw in. Retreats. Curiosity vs caution.',
      ],
    },
    wrestle: {
      name: 'wrestle',
      effects: [['dopamine', 0.3], ['adrenaline', 0.18], ['boredom', -0.4],
               ['loneliness', -0.25], ['oxytocin', 0.12], ['trust', 0.006],
               ['fatigue', 0.1], ['glucose', -0.1]],
      messagesHighTrust: [
        '{name} latches onto your hand with all four paws and fake-bites. This is COMBAT. Tiny, adorable combat.',
        '{name} flips onto its back, grabs your finger, and kicks with its back feet. Devastating. Lethal. Ticklish.',
        '{name} wrestles your hand into submission and then licks the exact spot it just bit. Apology? Victory lap? Both.',
      ],
      messagesLowTrust: [
        '{name} nips your finger and immediately runs. Test. Seeing what happens.',
        '{name} grapples cautiously. One paw. Then releases and backs up. Thinking about it.',
      ],
    },
    steal: {
      name: 'steal',
      effects: [['dopamine', 0.3], ['curiosity_trait', 0.03], ['boredom', -0.35],
               ['serotonin', 0.1], ['glucose', -0.04]],
      messagesHighTrust: [
        '{name} steals your pen. Right out of your hand. While you were using it. Makes eye contact. Runs.',
        '{name} has acquired an item. You don\'t know what yet. You\'ll find out when it\'s missing.',
        '{name} drags something three times its weight across the room and wedges it under the couch. Proud.',
        '{name} opens a zipper on your bag, takes something, and closes it again. WHEN DID IT LEARN ZIPPERS.',
      ],
      messagesLowTrust: [
        '{name} nudges something off the table when you\'re not looking. Wasn\'t me.',
        '{name} takes something small and hides. Testing boundaries.',
      ],
    },
    hide: {
      name: 'hide',
      effects: [['dopamine', 0.2], ['curiosity_trait', 0.02], ['boredom', -0.3],
               ['loneliness', -0.1], ['serotonin', 0.06]],
      messagesHighTrust: [
        '{name} hides in your hoodie. From inside your hoodie. While you\'re wearing it.',
        '{name} wedges itself somewhere impossible and goes limp. Good luck extracting it.',
        '{name} vanishes. You spend ten minutes looking. It was in the sock drawer. The closed sock drawer.',
      ],
      messagesLowTrust: [
        '{name} slinks under the nearest blanket. A lump. A suspicious, wriggling lump.',
        '{name} finds a dark corner and watches from it. Visible, but committed to the bit.',
      ],
    },
  },

  shinyWords: [
    'tunnel', 'chaos', 'socket', 'jingle', 'rubber',
    'bounce', 'sneak', 'stash', 'wiggle', 'mischief',
    'noodle', 'pocket', 'rustle', 'crinkle', 'zippy',
    'scramble', 'thief', 'velvet', 'marble', 'tangle',
    'quicksilver', 'ricochet', 'tumble', 'elastic', 'shimmy',
    'contraband', 'treasure', 'slinky', 'rattle', 'heist',
    'fizz', 'squirm', 'plunder', 'dash', 'loot',
    'sparkle', 'hoard', 'bolt', 'swipe', 'scurry',
    'pounce', 'weasel', 'bandit', 'gremlin', 'rascal',
  ],

  foundObjects: [
    'a sock (yours, stolen while you were wearing it)',
    'a rubber duck with a bite mark',
    'a pen cap chewed into modern art',
    'someone\'s earbuds (one of them)',
    'a crinkly wrapper from something forgotten',
    'a keychain shaped like a star',
    'a hair tie stretched beyond redemption',
    'a tiny shoe (from a doll, probably)',
    'a bottle cap collection (three, nested)',
    'a piece of foam from inside the couch',
    'a receipt from three weeks ago (important, apparently)',
    'a cable tie bent into a figure eight',
    'a button that fell off something expensive',
    'a plastic spoon handle (just the handle)',
    'a dice (the d20, naturally)',
    'a twist tie collection (seven, sorted by color)',
    'a lip balm cap (no lip balm)',
    'a USB cable (the wrong kind)',
    'a guitar pick stolen from someone\'s pocket',
    'a piece of string with three knots in it',
    'a candy wrapper that still smells like strawberry',
    'a screw that came from somewhere important',
    'a paperclip bent into a crown',
    'a piece of velcro (the scratchy side)',
    'a bead from a broken bracelet',
    'a coin wedged somewhere impossible',
    'a tiny rubber band ball (six bands)',
    'half a zipper pull',
    'a shoelace (just one, from the good pair)',
    'a thimble worn like a hat',
  ],

  giftAcceptHighTrust: [
    '{name} snatches "{content}" and does the war dance. TREASURE. WAR DANCE. TREASURE.',
    '{name} takes "{content}" and immediately hides it somewhere you will never find.',
    '{name} grabs "{content}", adds it to the stash, rearranges the stash, inspects the stash. Satisfied dook.',
  ],
  giftAcceptMidTrust: [
    '{name} sniffs "{content}" for a suspiciously long time. Takes it. Runs.',
    '{name} accepts "{content}" with cautious enthusiasm. Tucks it under itself protectively.',
  ],
  giftAcceptLowTrust: [
    '{name} grabs "{content}" at top speed and vanishes into the tunnel. MINE.',
    '{name} takes "{content}" while watching you with one eye. Trust, but verify.',
  ],
  giftRejectStressed: [
    '{name} pushes "{content}" away and retreats to the hammock. Not today.',
    '{name} hisses softly at "{content}". Bad vibes. No.',
  ],
  giftRejectNormal: [
    '{name} sniffs "{content}", looks at you with palpable disappointment, walks away.',
    '{name} pushes "{content}" off the nearest surface. Not interesting enough.',
  ],
  tradeAcceptTreasured: [
    '{name} stares at "{offering}" for ages. Clutches it. Looks at "{getting}". Finally pushes "{offering}" toward you with its nose and snatches "{getting}" before you can change your mind. That HURT.',
  ],
  tradeAcceptValued: [
    '{name} considers the deal. Drops "{offering}". Grabs "{getting}". Runs before you rethink it.',
  ],
  tradeAcceptNormal: [
    '{name} doesn\'t even look at "{offering}" properly before grabbing "{getting}". UPGRADE. BYE.',
  ],
  tradeRejectTreasured: [
    '{name} curls around "{his_item}" and goes boneless. You cannot have this. It would rather die.',
  ],
  tradeRejectStressed: [
    '{name} retreats to the stash. No trades. Bad day.',
  ],
  tradeRejectNormal: [
    '{name} sniffs "{offering}" and then deliberately knocks it onto the floor. "{his_item}" stays.',
  ],

  uniqueMechanic: 'war_dance',
  uniqueMechanicDescription: 'When dopamine spikes above 0.7, the ferret war-dances \u2014 chaotic sideways bouncing. Increases oxytocin and reduces negative drives.',
};
