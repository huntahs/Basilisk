const { Events } = require('discord.js');
const { initPokemonGameJob } = require('../services/pokemonGameJob');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Basilisk is online as ${client.user.tag}. Serving ${client.guilds.cache.size} guild(s).`);
    initPokemonGameJob(client);
  },
};
