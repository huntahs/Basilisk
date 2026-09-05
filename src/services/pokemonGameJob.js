const cron = require('node-cron');
const { AttachmentBuilder } = require('discord.js');
const { baseEmbed } = require('./embeds');
const { getRandomPokemon, generateSilhouetteBuffer } = require('./pokemon');
const { getAllPokemonChannels, setPokemonRound } = require('./db');

/**
 * Posts a single "Who's That Pokemon?" round to one channel, and records
 * the round (answer + message id) so events/messageCreate.js can check
 * incoming guesses against it.
 */
async function postPokemonRound(client, guildId, channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} not found (guild ${guildId})`);
  }

  const pokemon = await getRandomPokemon();
  const silhouetteBuffer = await generateSilhouetteBuffer(pokemon.imageUrl);

  const attachment = new AttachmentBuilder(silhouetteBuffer, { name: 'silhouette.png' });
  const embed = baseEmbed({
    title: "🔍 Who's That Pokémon?",
    description: 'Type your guess in this channel! First correct answer wins.',
    footer: 'Data via PokeAPI',
  }).setImage('attachment://silhouette.png');

  const message = await channel.send({ embeds: [embed], files: [attachment] });

  setPokemonRound(guildId, {
    channelId,
    messageId: message.id,
    answer: pokemon.name,
  });

  return { message, pokemon };
}

async function postPokemonRoundToAllGuilds(client) {
  const configs = getAllPokemonChannels();

  for (const { guildId, channelId } of configs) {
    try {
      await postPokemonRound(client, guildId, channelId);
    } catch (error) {
      console.error(`Error posting Pokemon round to guild ${guildId}:`, error);
      // Deliberately don't rethrow - one guild's failure shouldn't stop the others.
    }
  }
}

/**
 * Schedules the daily "Who's That Pokemon?" post for 9 AM Central time.
 * Call this once after the bot logs in (see events/ready.js).
 */
function initPokemonGameJob(client) {
  cron.schedule(
    '0 9 * * *',
    () => {
      postPokemonRoundToAllGuilds(client);
    },
    { timezone: 'America/Chicago' }
  );

  console.log('"Who\'s That Pokemon?" job scheduled for 9:00 AM America/Chicago.');
}

module.exports = { initPokemonGameJob, postPokemonRoundToAllGuilds, postPokemonRound };
