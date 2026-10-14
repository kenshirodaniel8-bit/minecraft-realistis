// Gameplay tunables shared by the server and the browser.
// Everything balance-related lives here so it can be adjusted in one place.

export const GAME_NAME = 'STEAL A MONSTER';
export const PROTOCOL_VERSION = 1;
export const SAVE_SCHEMA_VERSION = 2;
export const WORLD_SEED = 'project-titan';

export const CONFIG = {
  // --- server loop -------------------------------------------------------
  tickRate: 20,            // simulation steps per second
  snapshotRate: 10,        // world snapshots sent per second
  interestRadius: 135,     // monsters farther than this from a player are not sent to them
  maxPlayers: 12,          // also the number of base plots

  // --- new players -------------------------------------------------------
  startingMoney: 1000,     // granted once, only when a brand-new profile is created
  startingSword: 'wooden',
  startingItems: { knockback: 1, sticky_trap: 2 },
  startingSlots: 4,

  // --- player ------------------------------------------------------------
  player: {
    walkSpeed: 16,
    sprintSpeed: 24,
    jumpVelocity: 15,
    gravity: 46,
    swimSpeedFactor: 0.65,
    carrySpeedFactor: 0.8,
    radius: 0.9,
    height: 4.6,
    baseHp: 100,
    hpPerLevel: 12,
    regenDelayMs: 5000,
    regenPerSecond: 0.06,  // fraction of max hp per second when out of combat
    respawnMs: 3000,
    spawnProtectionMs: 3000,
    dodgeMs: 380,           // invulnerable while rolling
    dodgeCooldownMs: 1400,
    dodgeDistance: 9,
    lavaDps: 18,
  },

  // --- movement validation (anti-cheat) ----------------------------------
  movement: {
    speedTolerance: 1.35,    // accepted multiple of the theoretical max horizontal speed
    slackUnits: 2.5,         // extra distance allowed per update (network jitter)
    maxUpdateGapMs: 1000,    // movement budget never grows beyond this gap
    maxHeightAboveGround: 26,
    knockbackAllowanceMs: 900,
  },

  // --- combat ------------------------------------------------------------
  combat: {
    attackArcDeg: 110,       // swing cone in front of the player
    rangeTolerance: 0.75,    // extra reach accepted for latency
    comboWindowMs: 1100,
    comboBonus: 0.25,        // third hit of a combo
    critChance: 0.08,
    critMultiplier: 1.6,
    damageVariance: 0.1,
    assistShare: 0.1,        // fraction of max hp a player must deal to be offered recruitment
    defeatedWindowMs: 35000, // how long a defeated monster waits to be recruited
    exclusiveRecruitMs: 12000, // top-damage player has priority this long
    leashFactor: 2.2,        // monsters give up a chase this many territory radii from home
  },

  // --- monsters in the world ---------------------------------------------
  monsters: {
    baseCap: 70,             // max wild monsters (scaled up by world expansion)
    perPlayerCap: 12,
    hardCap: 180,
    activationRadius: 190,   // regions with a player this close spawn and think
    spawnMinPlayerDist: 32,  // never pop in right next to someone
    spawnMaxPlayerDist: 165,
    dormantAfterMs: 45000,   // despawn monsters no player has been near for this long
    maxProjectiles: 80,
  },

  // --- recruitment -------------------------------------------------------
  recruitment: {
    maxDistance: 14,
    declineRule: 'recover', // 'recover': monster wakes up, runs off and respawns later
    recoverRespawnMs: 20000,
  },

  // --- bases -------------------------------------------------------------
  bases: {
    ringRadius: 98,
    size: 26,                // square footprint (wall to wall)
    wallHeight: 8,
    doorWidth: 10,
    maxSlots: 12,
    slotUpgrades: [         // price to go from (index*2 + startingSlots) to +2 slots
      { slots: 6, price: 1500, level: 2 },
      { slots: 8, price: 6000, level: 5 },
      { slots: 10, price: 20000, level: 9, gems: 3 },
      { slots: 12, price: 60000, level: 14, gems: 8 },
    ],
    incomeAccumulateCap: 3600, // seconds of income a base can hold before collecting
    offlineIncomeRate: 0.5,
    offlineIncomeMaxHours: 8,
  },

  // --- security & stealing -----------------------------------------------
  security: {
    lockDurationsSec: [60, 75, 95, 120], // by laser upgrade level
    laserUpgradePrices: [3000, 12000, 40000],
    laserUpgradeGems: [0, 0, 4],
    relockCooldownSec: 5,
    requireAtBaseToLock: true,
  },
  stealing: {
    holdMs: 1200,            // hold E this long next to a monster to grab it
    holdToleranceMs: 250,
    maxDistance: 5,
    carryTimeoutMs: 120000,  // theft fails if not delivered in time
    dropRule: 'dropRecoverable', // 'returnToOwner' | 'dropRecoverable'
    dropRecoverMs: 9000,     // dropped monster waits this long before flying home
    regrabCooldownMs: 3000,
    victimProtectionMs: 0,
  },
  homeTeleport: {
    cooldownMs: 20000,
    allowWhileCarrying: false,
    allowInCombatMs: 0,      // >0 blocks teleporting this long after taking damage
    channelMs: 0,
  },

  // --- economy -----------------------------------------------------------
  economy: {
    maxMoney: 1e12,
    shopRange: 14,           // purchases must happen next to the shop
    requireShopProximity: true,
  },

  // --- progression -------------------------------------------------------
  progression: {
    maxLevel: 40,
    xpBase: 60,
    xpExponent: 1.55,
  },

  // --- lucky blocks & events ---------------------------------------------
  // --- Monster Gems: the rare upgrade material ------------------------------
  gems: {
    max: 1000000,
    // dropped by defeated monsters, per player who helped (rolled per rarity)
    drops: {
      rare: { chance: 0.35, min: 1, max: 1 },
      epic: { chance: 1, min: 1, max: 2 },
      legendary: { chance: 1, min: 3, max: 5 },
      secret: { chance: 1, min: 4, max: 6 },
      event: { chance: 1, min: 1, max: 2 },
    },
    regionBonus: { volcanic: 1 },   // the Volcanic Kingdom is rich in gems
    geodeRegions: ['volcanic', 'crystal'],
    geodesPerRegion: 2,
    geodeRespawnMs: 240000,
    geodeReward: [2, 4],
  },
  lucky: {
    claimRange: 6,
    ambientPerRegion: 1,     // lucky blocks always present per active region
    ambientRespawnMs: 180000,
  },
  events: {
    luckyLucky: {
      firstDelayMs: 4 * 60 * 1000,
      intervalMs: 14 * 60 * 1000,
      announceMs: 10000,
      durationMs: 150000,
      blocks: 24,
      rareSpawnMultiplier: 3,
    },
  },

  // --- world expansion ---------------------------------------------------
  // Regions also carry a minPopulation; these tiers add monster capacity.
  expansion: {
    shrinkDelayMs: 60000,    // hysteresis before closing regions after players leave
    closeWarningMs: 15000,
  },

  // --- network hygiene ---------------------------------------------------
  rateLimits: {
    // events per second (burst = 2x)
    move: 30,
    attack: 12,
    default: 8,
    chat: 1.5,
  },

  // --- day / night -------------------------------------------------------
  dayLengthMs: 12 * 60 * 1000,
};

// Allow a few overrides through environment variables on the server.
export function applyEnvOverrides(env = {}) {
  if (env.LUCKY_EVENT_FIRST_MS) CONFIG.events.luckyLucky.firstDelayMs = Number(env.LUCKY_EVENT_FIRST_MS);
  if (env.LUCKY_EVENT_INTERVAL_MS) CONFIG.events.luckyLucky.intervalMs = Number(env.LUCKY_EVENT_INTERVAL_MS);
  if (env.MAX_PLAYERS) CONFIG.maxPlayers = Math.max(1, Math.min(12, Number(env.MAX_PLAYERS) | 0));
}

export function xpForLevel(level) {
  const p = CONFIG.progression;
  return Math.round(p.xpBase * Math.pow(level, p.xpExponent));
}

export function maxHpForLevel(level) {
  return CONFIG.player.baseHp + CONFIG.player.hpPerLevel * (level - 1);
}
