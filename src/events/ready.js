const { Events } = require('discord.js');
const { initPokemonGameJob } = require('../services/pokemonGameJob');
const { initInstagramJob } = require('../services/instagramJob');
const { initStatusScheduler } = require('../services/statusScheduler');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Basilisk is online as ${client.user.tag}. Serving ${client.guilds.cache.size} guild(s).`);
    initPokemonGameJob(client);
    initInstagramJob(client);
    initStatusScheduler(client);
  },
};
