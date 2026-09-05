const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { baseEmbed } = require('../../services/embeds');
const { getLeagueProfile, analyzeRecentRankedSolo, getTopChampionMastery, RiotApiError } = require('../../services/riot');
const { getChampionName, getProfileIconUrl } = require('../../services/ddragon');

const QUEUE_LABELS = {
  RANKED_SOLO_5x5: 'Ranked Solo/Duo',
  RANKED_FLEX_SR: 'Ranked Flex',
};

// op.gg region codes match our own region keys 1:1 (na, euw, eune, kr, oce).
const OPGG_REGION = {
  na: 'na',
  euw: 'euw',
  eune: 'eune',
  kr: 'kr',
  oce: 'oce',
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

      // Profile icon as thumbnail - don't let a Data Dragon hiccup break the
      // whole command, just skip the thumbnail if it fails.
      try {
        const iconUrl = await getProfileIconUrl(profile.profileIconId);
        embed.setThumbnail(iconUrl);
      } catch (iconError) {
        console.error('Error fetching profile icon:', iconError);
      }

      // --- Current rank + win rate ---
      const soloEntry = profile.rankedEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
      if (soloEntry) {
        embed.addFields(
          { name: 'Rank (Solo/Duo)', value: formatRank(soloEntry), inline: true },
          { name: 'Win Rate (Solo/Duo)', value: formatWinRate(soloEntry), inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
        );
      } else {
        embed.addFields({ name: 'Rank (Solo/Duo)', value: 'Unranked this season.' });
      }

      // Any other queues (e.g. Flex) shown separately, lower priority
      for (const entry of profile.rankedEntries) {
        if (entry.queueType === 'RANKED_SOLO_5x5') continue;
        const label = QUEUE_LABELS[entry.queueType] || entry.queueType;
        embed.addFields(
          { name: label, value: formatRank(entry), inline: true },
          { name: 'Win Rate', value: formatWinRate(entry), inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
        );
      }

      // --- Recent ranked solo trends: lane, top champs, performance metrics ---
      // This is the expensive part (~20 extra API calls), so it's wrapped in
      // its own try/catch - if it fails, the rank info above still gets sent.
      try {
        const trends = await analyzeRecentRankedSolo(profile.puuid, profile.regionalRoute);

        if (trends.gamesAnalyzed === 0) {
          embed.addFields({
            name: 'Recent Ranked Solo Trends',
            value: 'No recent ranked solo/duo games found.',
          });
        } else {
          embed.addFields({
            name: `Primary Lane (last ${trends.gamesAnalyzed} ranked solo games)`,
            value: trends.topLane || 'Unknown',
          });

          for (const champ of trends.topChampions) {
            embed.addFields({
              name: `Most Played: ${champ.name}`,
              value: `${champ.games} games • ${champ.winRate}% win rate (${champ.wins}W ${champ.losses}L)`,
              inline: true,
            });
          }

          const m = trends.metrics;
          embed.addFields({
            name: `Performance (last ${trends.gamesAnalyzed} ranked solo games)`,
            value:
              `KDA: **${m.kda === null ? 'Perfect' : m.kda}**  •  ` +
              `Kill Participation: **${m.killParticipationPct}%**  •  ` +
              `Team Damage Share: **${m.teamDamageSharePct}%**\n` +
              `Gold/min: **${m.goldPerMin}**  •  ` +
              `CS/min: **${m.csPerMin}**  •  ` +
              `Vision Score/min: **${m.visionScorePerMin}**`,
          });
        }
      } catch (trendsError) {
        console.error('Error computing recent ranked solo trends:', trendsError);
        embed.addFields({
          name: 'Recent Ranked Solo Trends',
          value: "Couldn't load right now - try again shortly.",
        });
      }

      // --- Highest mastery champions ---
      try {
        const masteryEntries = await getTopChampionMastery(profile.puuid, profile.platform, 3);
        const masteryLines = await Promise.all(
          masteryEntries.map(async (entry) => {
            const name = await getChampionName(entry.championId);
            return `**${name}** — Level ${entry.championLevel}, ${entry.championPoints.toLocaleString()} points`;
          })
        );

        embed.addFields({
          name: 'Highest Mastery Champions',
          value: masteryLines.join('\n') || 'No mastery data found.',
        });
      } catch (masteryError) {
        console.error('Error fetching champion mastery:', masteryError);
        embed.addFields({
          name: 'Highest Mastery Champions',
          value: "Couldn't load right now - try again shortly.",
        });
      }

      // --- op.gg button ---
      const opggRegion = OPGG_REGION[regionKey] || 'na';
      const opggUrl = `https://op.gg/lol/summoners/${opggRegion}/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('View on op.gg')
          .setStyle(ButtonStyle.Link)
          .setURL(opggUrl)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      if (error instanceof RiotApiError) {
        await interaction.editReply(`Couldn't get that player's data: ${error.message}`);
        return;
      }
      throw error; // let interactionCreate's generic handler log/report anything unexpected
    }
  },
};
