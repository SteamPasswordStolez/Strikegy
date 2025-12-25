// src/data/botDifficulty.js
// Patch 9-3C+: Bot difficulty presets (lobby selectable)

export const BOT_DIFFICULTY_KEY = "botDifficulty";

// NOTE
// - These values are tuning knobs.
// - Keep changes centralized here so later patches can rebalance without touching bot logic.
export const BOT_DIFFICULTY_PRESETS = Object.freeze({
  very_easy: {
    label: "Very Easy",
    detectRange: 18,
    engageRange: 12,
    detectNeedMin: 0.32,
    detectNeedMax: 0.55,
    reactionMin: 0.55,
    reactionMax: 0.85,
    firstShotMin: 0.18,
    firstShotMax: 0.32,
    aimErrMult: 1.55,
    hitChanceMult: 0.72,
    headshotChanceMult: 0.65,
    burstMin: 1,
    burstMax: 2,
    burstPauseMin: 0.38,
    burstPauseMax: 0.58,
    // "how much they push/chase" (1.0 = baseline)
    aggression: 0.65,
    // bot-vs-bot extras
    vsBotDetectMult: 1.05,
    // Hotfix 9-4E.2: bot-vs-bot is more alive even on low difficulties
    vsBotAggression: 1.40,
    vsBotHuntChancePerSec: 0.10,
  },
  easy: {
    label: "Easy",
    detectRange: 22,
    engageRange: 15,
    detectNeedMin: 0.26,
    detectNeedMax: 0.45,
    reactionMin: 0.42,
    reactionMax: 0.70,
    firstShotMin: 0.15,
    firstShotMax: 0.28,
    aimErrMult: 1.25,
    hitChanceMult: 0.85,
    headshotChanceMult: 0.80,
    burstMin: 2,
    burstMax: 3,
    burstPauseMin: 0.28,
    burstPauseMax: 0.45,
    aggression: 0.85,
    vsBotDetectMult: 1.08,
    vsBotAggression: 1.70,
    vsBotHuntChancePerSec: 0.13,
  },
  normal: {
    label: "Normal",
    detectRange: 25,
    engageRange: 18,
    detectNeedMin: 0.18,
    detectNeedMax: 0.35,
    reactionMin: 0.35,
    reactionMax: 0.60,
    firstShotMin: 0.12,
    firstShotMax: 0.22,
    aimErrMult: 1.00,
    // Patch 10: slightly tougher baseline (without going full "aimbot")
    hitChanceMult: 1.05,
    headshotChanceMult: 1.05,
    burstMin: 2,
    burstMax: 4,
    burstPauseMin: 0.20,
    burstPauseMax: 0.35,
    // Patch 9-4D: overall decision/pressure up (more "alive")
    aggression: 1.20,
    vsBotDetectMult: 1.12,
    vsBotAggression: 2.60,
    vsBotHuntChancePerSec: 0.26,
  },
  hard: {
    label: "Hard",
    detectRange: 29,
    engageRange: 21,
    detectNeedMin: 0.14,
    detectNeedMax: 0.28,
    reactionMin: 0.28,
    reactionMax: 0.50,
    firstShotMin: 0.10,
    firstShotMax: 0.20,
    aimErrMult: 0.85,
    hitChanceMult: 1.18,
    headshotChanceMult: 1.20,
    burstMin: 3,
    burstMax: 5,
    burstPauseMin: 0.16,
    burstPauseMax: 0.28,
    aggression: 1.45,
    vsBotDetectMult: 1.16,
    vsBotAggression: 3.20,
    vsBotHuntChancePerSec: 0.34,
  },
  expert: {
    label: "Expert",
    detectRange: 33,
    engageRange: 24,
    detectNeedMin: 0.10,
    detectNeedMax: 0.22,
    reactionMin: 0.22,
    reactionMax: 0.42,
    firstShotMin: 0.08,
    firstShotMax: 0.16,
    aimErrMult: 0.75,
    hitChanceMult: 1.22,
    headshotChanceMult: 1.30,
    burstMin: 4,
    burstMax: 6,
    burstPauseMin: 0.12,
    burstPauseMax: 0.24,
    aggression: 1.52,
    vsBotDetectMult: 1.20,
    vsBotAggression: 3.80,
    vsBotHuntChancePerSec: 0.42,
  },
  nightmare: {
    label: "Nightmare",
    // Patch 9-4D.1: Nightmare = "unfair" brain.
    // Faster confirmation, faster reaction, higher pressure.
    detectRange: 46,
    engageRange: 34,
    detectNeedMin: 0.04,
    detectNeedMax: 0.12,
    reactionMin: 0.10,
    reactionMax: 0.22,
    firstShotMin: 0.04,
    firstShotMax: 0.10,
    aimErrMult: 0.50,
    hitChanceMult: 1.55,
    headshotChanceMult: 1.85,
    burstMin: 6,
    burstMax: 9,
    burstPauseMin: 0.06,
    burstPauseMax: 0.14,
    aggression: 2.25,
    vsBotDetectMult: 1.35,
    vsBotAggression: 5.00,
    vsBotHuntChancePerSec: 0.70,
  },
});

export function normalizeBotDifficulty(id){
  const k = String(id || "").toLowerCase();
  if(Object.prototype.hasOwnProperty.call(BOT_DIFFICULTY_PRESETS, k)) return k;
  return "normal";
}

export function getBotDifficultyPreset(id){
  const k = normalizeBotDifficulty(id);
  return BOT_DIFFICULTY_PRESETS[k] || BOT_DIFFICULTY_PRESETS.normal;
}
