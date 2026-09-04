const { Events } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Basilisk is online as ${client.user.tag}. Serving ${client.guilds.cache.size} guild(s).`);
  },
};
