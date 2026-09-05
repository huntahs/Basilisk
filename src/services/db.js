// Local JSON-file storage - persists across bot restarts so we don't lose
// track of which channels are "Join to Create" hubs, or which channels are
// bot-created temp voice channels, if Wispbyte restarts the process.
//
// This is intentionally NOT a real database (no better-sqlite3, no native
// dependencies) - our storage needs are tiny (a handful of hub/channel IDs
// at any given time), and native modules like better-sqlite3 require a
// prebuilt binary matching the exact Node version/platform. Wispbyte runs a
// non-LTS Node version (19.x) with no matching prebuild and no compiler
// available to build one from source, so a plain JSON file sidesteps that
// whole problem entirely.

const fs = require('node:fs');
const path = require('node:path');
const { getPreviousDateStr } = require('./dateUtils');

const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dataFile = path.join(dataDir, 'basilisk.json');

const EMPTY_DATA = {
  voiceHubs: [],
  tempChannels: [],
  pokemonChannels: [],
  pokemonRounds: [],
  instagramConfigs: [],
  botStatus: null,
  workoutRecords: [],
  workoutLogs: [],
  workoutConfigs: [],
};

function loadData() {
  if (!fs.existsSync(dataFile)) {
    return { ...EMPTY_DATA };
  }
  try {
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    // Backfill in case this file was written before these fields existed.
    if (!data.pokemonChannels) data.pokemonChannels = [];
    if (!data.pokemonRounds) data.pokemonRounds = [];
    if (!data.instagramConfigs) data.instagramConfigs = [];
    if (data.botStatus === undefined) data.botStatus = null;
    if (!data.workoutRecords) data.workoutRecords = [];
    if (!data.workoutLogs) data.workoutLogs = [];
    if (!data.workoutConfigs) data.workoutConfigs = [];
    return data;
  } catch (error) {
    console.error('Error reading basilisk.json, starting fresh:', error);
    return { ...EMPTY_DATA };
  }
}

function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function addVoiceHub(guildId, hubChannelId) {
  const data = loadData();
  const exists = data.voiceHubs.some((h) => h.guildId === guildId && h.hubChannelId === hubChannelId);
  if (!exists) {
    data.voiceHubs.push({ guildId, hubChannelId });
    saveData(data);
  }
}

function removeVoiceHub(guildId, hubChannelId) {
  const data = loadData();
  data.voiceHubs = data.voiceHubs.filter((h) => !(h.guildId === guildId && h.hubChannelId === hubChannelId));
  saveData(data);
}

function isHubChannel(channelId) {
  const data = loadData();
  return data.voiceHubs.some((h) => h.hubChannelId === channelId);
}

function addTempChannel(channelId, guildId, hubChannelId, ownerId) {
  const data = loadData();
  data.tempChannels.push({ channelId, guildId, hubChannelId, ownerId, createdAt: Date.now() });
  saveData(data);
}

function isTempChannel(channelId) {
  const data = loadData();
  return data.tempChannels.some((c) => c.channelId === channelId);
}

function removeTempChannel(channelId) {
  const data = loadData();
  data.tempChannels = data.tempChannels.filter((c) => c.channelId !== channelId);
  saveData(data);
}

function setPokemonChannel(guildId, channelId) {
  const data = loadData();
  const existing = data.pokemonChannels.find((g) => g.guildId === guildId);
  if (existing) {
    existing.channelId = channelId;
  } else {
    data.pokemonChannels.push({ guildId, channelId });
  }
  saveData(data);
}

function getPokemonChannel(guildId) {
  const data = loadData();
  return data.pokemonChannels.find((g) => g.guildId === guildId)?.channelId || null;
}

function getAllPokemonChannels() {
  const data = loadData();
  return data.pokemonChannels; // [{ guildId, channelId }, ...]
}

/**
 * Tracks the currently active "Who's That Pokemon?" round for a guild -
 * one round at a time per guild. `answer` is stored lowercase for
 * case-insensitive matching against incoming messages. `creditedUserIds`
 * tracks who has already been given credit THIS round, so someone
 * discussing the answer after guessing correctly doesn't get their
 * follow-up messages deleted too. This always resets to [] whenever a new
 * round starts (i.e. once a day), which is what gives the "resets after 24
 * hours" behavior without needing a separate timer.
 */
function setPokemonRound(guildId, { channelId, messageId, answer }) {
  const data = loadData();
  const existing = data.pokemonRounds.find((r) => r.guildId === guildId);
  const round = { guildId, channelId, messageId, answer: answer.toLowerCase(), creditedUserIds: [] };
  if (existing) {
    Object.assign(existing, round);
  } else {
    data.pokemonRounds.push(round);
  }
  saveData(data);
}

function getPokemonRound(guildId) {
  const data = loadData();
  return data.pokemonRounds.find((r) => r.guildId === guildId) || null;
}

function hasPokemonUserBeenCredited(guildId, userId) {
  const round = getPokemonRound(guildId);
  return !!round?.creditedUserIds.includes(userId);
}

function addPokemonCreditedUser(guildId, userId) {
  const data = loadData();
  const existing = data.pokemonRounds.find((r) => r.guildId === guildId);
  if (existing && !existing.creditedUserIds.includes(userId)) {
    existing.creditedUserIds.push(userId);
    saveData(data);
  }
}

/**
 * Instagram announcement config, one per guild:
 *   - channelId: where to post new-post announcements
 *   - accessToken: current long-lived Instagram Graph API token (mutable -
 *     gets overwritten in place whenever the refresh job successfully
 *     refreshes it, so this is always the CURRENT valid token, not the
 *     original one from initial setup)
 *   - tokenRefreshedAt: timestamp (ms) of the last successful refresh, used
 *     to decide when the next refresh is due (tokens are valid 60 days)
 *   - lastSeenMediaId: the most recent Instagram post ID we've already
 *     either announced or deliberately skipped (on first setup) - prevents
 *     re-announcing the same post or dumping the whole history on setup
 */
function setInstagramConfig(guildId, { channelId, accessToken, lastSeenMediaId }) {
  const data = loadData();
  const existing = data.instagramConfigs.find((c) => c.guildId === guildId);
  const config = {
    guildId,
    channelId,
    accessToken,
    tokenRefreshedAt: Date.now(),
    lastSeenMediaId: lastSeenMediaId || null,
  };
  if (existing) {
    Object.assign(existing, config);
  } else {
    data.instagramConfigs.push(config);
  }
  saveData(data);
}

function getInstagramConfig(guildId) {
  const data = loadData();
  return data.instagramConfigs.find((c) => c.guildId === guildId) || null;
}

function getAllInstagramConfigs() {
  const data = loadData();
  return data.instagramConfigs;
}

function updateInstagramLastSeenMediaId(guildId, mediaId) {
  const data = loadData();
  const existing = data.instagramConfigs.find((c) => c.guildId === guildId);
  if (existing) {
    existing.lastSeenMediaId = mediaId;
    saveData(data);
  }
}

function updateInstagramToken(guildId, newAccessToken) {
  const data = loadData();
  const existing = data.instagramConfigs.find((c) => c.guildId === guildId);
  if (existing) {
    existing.accessToken = newAccessToken;
    existing.tokenRefreshedAt = Date.now();
    saveData(data);
  }
}

/**
 * Bot presence/activity is GLOBAL (not per-guild - a bot has one status
 * across every server it's in), so this isn't keyed by guildId like
 * everything else. Tracks when a temporary "New Post!" status should
 * revert back to normal, so it survives a bot restart mid-window instead
 * of relying on an in-memory setTimeout that would be lost on restart.
 */
function setTemporaryBotStatus(expiresAt) {
  const data = loadData();
  data.botStatus = { expiresAt };
  saveData(data);
}

function getTemporaryBotStatus() {
  const data = loadData();
  return data.botStatus;
}

function clearTemporaryBotStatus() {
  const data = loadData();
  data.botStatus = null;
  saveData(data);
}

// --- Workout PR records (squat/bench/deadlift with video proof) ---

const KG_TO_LBS = 2.20462;
function toLbsValue(record) {
  return record.unit === 'kg' ? record.weight * KG_TO_LBS : record.weight;
}

function addWorkoutRecord(guildId, { messageId, channelId, userId, lift, weight, unit }) {
  const data = loadData();
  data.workoutRecords.push({
    messageId,
    channelId,
    guildId,
    userId,
    lift,
    weight,
    unit,
    submittedAt: Date.now(),
  });
  saveData(data);
}

/**
 * Returns true if something was actually removed (so callers - both the
 * manual /workout nix command and the automatic message-delete cleanup -
 * can tell whether the message ID actually corresponded to a real record).
 */
function removeWorkoutRecordByMessageId(messageId) {
  const data = loadData();
  const before = data.workoutRecords.length;
  data.workoutRecords = data.workoutRecords.filter((r) => r.messageId !== messageId);
  saveData(data);
  return data.workoutRecords.length < before;
}

function isTrackedWorkoutMessage(messageId) {
  const data = loadData();
  return data.workoutRecords.some((r) => r.messageId === messageId);
}

/**
 * Returns each user's personal best for the given lift, sorted heaviest
 * first (converted to lbs for fair comparison across mixed-unit
 * submissions, though the DISPLAYED value stays in whatever unit the user
 * originally submitted).
 */
function getWorkoutLeaderboard(guildId, lift) {
  const data = loadData();
  const records = data.workoutRecords.filter((r) => r.guildId === guildId && r.lift === lift);

  const bestByUser = {};
  for (const record of records) {
    const existing = bestByUser[record.userId];
    if (!existing || toLbsValue(record) > toLbsValue(existing)) {
      bestByUser[record.userId] = record;
    }
  }

  return Object.values(bestByUser).sort((a, b) => toLbsValue(b) - toLbsValue(a));
}

// --- Daily workout logging (no proof, one per day, streak-tracked) ---

function logWorkout(guildId, userId, dateStr) {
  const data = loadData();
  let log = data.workoutLogs.find((l) => l.guildId === guildId && l.userId === userId);

  if (!log) {
    log = { guildId, userId, lastLoggedDate: dateStr, currentStreak: 1 };
    data.workoutLogs.push(log);
    saveData(data);
    return { streak: 1, alreadyLoggedToday: false };
  }

  if (log.lastLoggedDate === dateStr) {
    return { streak: log.currentStreak, alreadyLoggedToday: true };
  }

  const yesterday = getPreviousDateStr(dateStr);
  log.currentStreak = log.lastLoggedDate === yesterday ? log.currentStreak + 1 : 1;
  log.lastLoggedDate = dateStr;
  saveData(data);
  return { streak: log.currentStreak, alreadyLoggedToday: false };
}

function getWorkoutLogsForDate(guildId, dateStr) {
  const data = loadData();
  return data.workoutLogs.filter((l) => l.guildId === guildId && l.lastLoggedDate === dateStr);
}

function setWorkoutChannel(guildId, channelId) {
  const data = loadData();
  const existing = data.workoutConfigs.find((c) => c.guildId === guildId);
  if (existing) {
    existing.channelId = channelId;
  } else {
    data.workoutConfigs.push({ guildId, channelId });
  }
  saveData(data);
}

function getWorkoutChannel(guildId) {
  const data = loadData();
  return data.workoutConfigs.find((c) => c.guildId === guildId)?.channelId || null;
}

function getAllWorkoutChannels() {
  const data = loadData();
  return data.workoutConfigs;
}

module.exports = {
  addVoiceHub,
  removeVoiceHub,
  isHubChannel,
  addTempChannel,
  isTempChannel,
  removeTempChannel,
  setPokemonChannel,
  getPokemonChannel,
  getAllPokemonChannels,
  setPokemonRound,
  getPokemonRound,
  hasPokemonUserBeenCredited,
  addPokemonCreditedUser,
  setInstagramConfig,
  getInstagramConfig,
  getAllInstagramConfigs,
  updateInstagramLastSeenMediaId,
  updateInstagramToken,
  setTemporaryBotStatus,
  getTemporaryBotStatus,
  clearTemporaryBotStatus,
  addWorkoutRecord,
  removeWorkoutRecordByMessageId,
  isTrackedWorkoutMessage,
  getWorkoutLeaderboard,
  logWorkout,
  getWorkoutLogsForDate,
  setWorkoutChannel,
  getWorkoutChannel,
  getAllWorkoutChannels,
};
