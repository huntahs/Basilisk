const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../../services/embeds');
// const { getValorantStats } = require('../../services/tracker');  // wire up once tracker.js is built

module.exports = {
  data: new SlashCommandBuilder()
    .setName('valorant')
    .setDescription('Look up a player\'s Valorant stats.')
    .addStringOption((option) =>
      option
        .setName('riot-id')
        .setDescription('Riot ID, e.g. Name#TAG')
        .setRequired(true)
    ),

  async execute(interaction) {
    const riotId = interaction.options.getString('riot-id');

    await interaction.deferReply(); // Tracker Network calls can take a moment

    // --- placeholder until src/services/tracker.js is implemented ---
    // const stats = await getValorantStats(riotId);
    const stats = {
      name: riotId,
      rank: 'Diamond 2',
      kd: '1.34',
      winRate: '54%',
      headshotPct: '27%',
    };
    // ------------------------------------------------------------------

    const embed = baseEmbed({
      title: `Valorant — ${stats.name}`,
      footer: 'Basilisk • Data via Tracker Network',
    })
      .addFields(
        { name: 'Rank', value: stats.rank, inline: true },
        { name: 'K/D', value: stats.kd, inline: true },
        { name: 'Win Rate', value: stats.winRate, inline: true },
        { name: 'Headshot %', value: stats.headshotPct, inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
