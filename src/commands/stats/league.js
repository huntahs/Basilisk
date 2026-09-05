const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../../services/embeds');
const { getLeagueProfile, RiotApiError, REGION_MAP } = require('../../services/riot');

const QUEUE_LABELS = {
  RANKED_SOLO_5x5: 'Ranked Solo/Duo',
  RANKED_FLEX_SR: 'Ranked Flex',
};

function formatRank(entry) {
  const tier = entry.tier.charAt(0) + entry.tier.slice(1).toLowerCase(); // GOLD -> Gold
  return `${tier} ${entry.rank} - ${entry.leaguePoints} LP`;
}

function formatWinRate(entry) {
  const total = entry.wins + entry.losses;
  if (total === 0) return 'N/A';
  return `${Math.round((entry.wins / total) * 100)}% (${entry.wins}W ${entry.losses}L)`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('league')
    .setDescription("Look up a player's League of Legends ranked stats.")
    .addStringOption((option) =>
      option
        .setName('riot-id')
        .setDescription('Riot ID, e.g. Name#TAG')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('region')
        .setDescription('Which server the player is on (defaults to NA)')
        .addChoices(
          { name: 'North America', value: 'na' },
          { name: 'EU West', value: 'euw' },
          { name: 'EU Nordic & East', value: 'eune' },
          { name: 'Korea', value: 'kr' },
          { name: 'Oceania', value: 'oce' },
        )
    ),

  async execute(interaction) {
    const riotIdInput = interaction.options.getString('riot-id');
    const regionKey = interaction.options.getString('region') || 'na';

    const [gameName, tagLine] = riotIdInput.split('#');
    if (!gameName || !tagLine) {
      await interaction.reply({
        content: 'That doesn\'t look like a valid Riot ID. Use the format `Name#TAG` (e.g. `Gyroscopic#Spin`).',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const profile = await getLeagueProfile(gameName, tagLine, regionKey);

      const embed = baseEmbed({
        title: `League of Legends — ${profile.riotId}`,
        description: `${profile.regionLabel} • Level ${profile.summonerLevel}`,
        footer: 'Data via Riot Games API',
      });

      if (profile.rankedEntries.length === 0) {
        embed.addFields({ name: 'Ranked', value: 'Unranked in all queues this season.' });
      } else {
        for (const entry of profile.rankedEntries) {
          const label = QUEUE_LABELS[entry.queueType] || entry.queueType;
          embed.addFields(
            { name: label, value: formatRank(entry), inline: true },
            { name: 'Win Rate', value: formatWinRate(entry), inline: true },
            { name: '\u200b', value: '\u200b', inline: true }, // spacer to keep 3-column layout even
          );
        }
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      if (error instanceof RiotApiError) {
        await interaction.editReply(`Couldn't get that player's data: ${error.message}`);
        return;
      }
      throw error; // let interactionCreate's generic handler log/report anything unexpected
    }
  },
};