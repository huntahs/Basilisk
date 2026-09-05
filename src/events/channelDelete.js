const { Events } = require('discord.js');
const { removeVoiceHub, removeTempChannel } = require('../services/db');

// If an admin manually deletes a hub channel or a temp channel (outside of
// Basilisk's own delete-when-empty logic), this keeps the database from
// holding onto stale references.
module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!channel.guild) return;
    removeVoiceHub(channel.guild.id, channel.id);
    removeTempChannel(channel.id);
  },
};
