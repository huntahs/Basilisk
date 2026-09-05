// Local SQLite database - persists across bot restarts so we don't lose
// track of which channels are "Join to Create" hubs, or which channels are
// bot-created temp voice channels, if Wispbyte restarts the process.

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'basilisk.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS voice_hubs (
    guild_id TEXT NOT NULL,
    hub_channel_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, hub_channel_id)
  );

  CREATE TABLE IF NOT EXISTS temp_voice_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    hub_channel_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

function addVoiceHub(guildId, hubChannelId) {
  db.prepare('INSERT OR IGNORE INTO voice_hubs (guild_id, hub_channel_id) VALUES (?, ?)').run(guildId, hubChannelId);
}

function removeVoiceHub(guildId, hubChannelId) {
  db.prepare('DELETE FROM voice_hubs WHERE guild_id = ? AND hub_channel_id = ?').run(guildId, hubChannelId);
}

function isHubChannel(channelId) {
  return !!db.prepare('SELECT 1 FROM voice_hubs WHERE hub_channel_id = ?').get(channelId);
}

function addTempChannel(channelId, guildId, hubChannelId, ownerId) {
  db.prepare(
    'INSERT INTO temp_voice_channels (channel_id, guild_id, hub_channel_id, owner_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(channelId, guildId, hubChannelId, ownerId, Date.now());
}

function isTempChannel(channelId) {
  return !!db.prepare('SELECT 1 FROM temp_voice_channels WHERE channel_id = ?').get(channelId);
}

function removeTempChannel(channelId) {
  db.prepare('DELETE FROM temp_voice_channels WHERE channel_id = ?').run(channelId);
}

module.exports = {
  addVoiceHub,
  removeVoiceHub,
  isHubChannel,
  addTempChannel,
  isTempChannel,
  removeTempChannel,
};
