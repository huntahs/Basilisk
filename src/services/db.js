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

const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dataFile = path.join(dataDir, 'basilisk.json');

function loadData() {
  if (!fs.existsSync(dataFile)) {
    return { voiceHubs: [], tempChannels: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (error) {
    console.error('Error reading basilisk.json, starting fresh:', error);
    return { voiceHubs: [], tempChannels: [] };
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

module.exports = {
  addVoiceHub,
  removeVoiceHub,
  isHubChannel,
  addTempChannel,
  isTempChannel,
  removeTempChannel,
};
