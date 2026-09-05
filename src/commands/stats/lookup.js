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

// Embed color reflects the player's current Solo/Duo rank tier - falls back
// to Basilisk's default UAB green if unranked.
const TIER_COLORS = {
  IRON: 0x51484a,
  BRONZE: 0x8a5a3b,
  SILVER: 0x9aa5ab,
  GOLD: 0xc89b3c,
  PLATINUM: 0x2ea6a6,
  EMERALD: 0x2f9e5f,
  DIAMOND: 0x576bcf,
  MASTER: 0x9d4ed9,
  GRANDMASTER: 0xc9425a,
  CHALLENGER: 0xf4e26b,
};

const GAME_DISPLAY_NAMES = {
  league: 'League of Legends',
  valorant: 'Valorant',
  overwatch: 'Overwatch 2',
  rocketleague: 'Rocket League',
  marvelrivals: 'Marvel Rivals',
  smash: 'Super Smash Bros. Ultimate',
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

/**
 * League of Legends lookup - the fully-built integration.
 * `username` is expected in Riot ID format: Name#TAG
 */
async function handleLeagueLookup(interaction, username, regionKey) {
  const [gameName, tagLine] = username.split('#').map((s) => s?.trim());
  if (!gameName || !tagLine) {
    await interaction.editReply(
      'That doesn\'t look like a valid Riot ID. Use the format `Name#TAG` (e.g. `Gyroscopic#Spin`).'
    );
    return;
  }

  try {
    const profile = await getLeagueProfile(gameName, tagLine, regionKey);

    const embed = baseEmbed({
      title: `League of Legends — ${profile.riotId}`,
      description: `${profile.regionLabel} • Level ${profile.summonerLevel}`,
      footer: 'Data via Riot Games API',
    });

    try {
      const iconUrl = await getProfileIconUrl(profile.profileIconId);
      embed.setThumbnail(iconUrl);
    } catch (iconError) {
      console.error('Error fetching profile icon:', iconError);
    }

    const soloEntry = profile.rankedEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
    if (soloEntry && TIER_COLORS[soloEntry.tier]) {
      embed.setColor(TIER_COLORS[soloEntry.tier]);
    }

    if (soloEntry) {
      embed.addFields(
        { name: '🏆 Rank (Solo/Duo)', value: formatRank(soloEntry), inline: true },
        { name: '📈 Win Rate (Solo/Duo)', value: formatWinRate(soloEntry), inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
      );
    } else {
      embed.addFields({ name: '🏆 Rank (Solo/Duo)', value: 'Unranked this season.' });
    }

    for (const entry of profile.rankedEntries) {
      if (entry.queueType === 'RANKED_SOLO_5x5') continue;
      const label = QUEUE_LABELS[entry.queueType] || entry.queueType;
      embed.addFields(
        { name: label, value: formatRank(entry), inline: true },
        { name: 'Win Rate', value: formatWinRate(entry), inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
      );
    }

    try {
      const trends = await analyzeRecentRankedSolo(profile.puuid, profile.regionalRoute);

      if (trends.gamesAnalyzed === 0) {
        embed.addFields({
          name: '📊 Recent Ranked Solo Trends',
          value: 'No recent ranked solo/duo games found.',
        });
      } else {
        embed.addFields({
          name: `🗺️ Primary Lane (last ${trends.gamesAnalyzed} ranked solo games)`,
          value: trends.topLane || 'Unknown',
        });

        for (const champ of trends.topChampions) {
          embed.addFields({
            name: `⚔️ Most Played: ${champ.name}`,
            value: `${champ.games} games • ${champ.winRate}% win rate (${champ.wins}W ${champ.losses}L)`,
            inline: true,
          });
        }

        const m = trends.metrics;
        embed.addFields({
          name: `📊 Performance (last ${trends.gamesAnalyzed} ranked solo games)`,
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
        name: '📊 Recent Ranked Solo Trends',
        value: "Couldn't load right now - try again shortly.",
      });
    }

    try {
      const masteryEntries = await getTopChampionMastery(profile.puuid, profile.platform, 3);
      const masteryLines = await Promise.all(
        masteryEntries.map(async (entry) => {
          const name = await getChampionName(entry.championId);
          return `**${name}** — Level ${entry.championLevel}, ${entry.championPoints.toLocaleString()} points`;
        })
      );

      embed.addFields({
        name: '⭐ Highest Mastery Champions',
        value: masteryLines.join('\n') || 'No mastery data found.',
      });
    } catch (masteryError) {
      console.error('Error fetching champion mastery:', masteryError);
      embed.addFields({
        name: '⭐ Highest Mastery Champions',
        value: "Couldn't load right now - try again shortly.",
      });
    }

    const opggRegion = OPGG_REGION[regionKey] || 'na';
    const opggUrl = `https://op.gg/lol/summoners/${opggRegion}/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔗 Full Stats on op.gg ↗')
        .setStyle(ButtonStyle.Link)
        .setURL(opggUrl)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    if (error instanceof RiotApiError) {
      await interaction.editReply(`Couldn't get that player's data: ${error.message}`);
      return;
    }
    throw error;
  }
}

/**
 * Valorant lookup - still a placeholder. Waiting on a production Riot key
 * with Valorant match/rank access before this pulls real data.
 */
async function handleValorantLookup(interaction, username) {
  const stats = {
    name: username,
    rank: 'Diamond 2',
    kd: '1.34',
    winRate: '54%',
    headshotPct: '27%',
  };

  const embed = baseEmbed({
    title: `Valorant — ${stats.name}`,
    footer: 'Basilisk • Data via Riot Games API (placeholder data for now)',
  }).addFields(
    { name: 'Rank', value: stats.rank, inline: true },
    { name: 'K/D', value: stats.kd, inline: true },
    { name: 'Win Rate', value: stats.winRate, inline: true },
    { name: 'Headshot %', value: stats.headshotPct, inline: true },
  );

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Placeholder for games without a working data source yet.
 */
async function handleNotYetSupported(interaction, gameKey, username) {
  const gameName = GAME_DISPLAY_NAMES[gameKey];
  const embed = baseEmbed({
    title: `${gameName} — ${username}`,
    description: `${gameName} lookups aren't available yet - we're still working on finding a reliable data source for this game. Check back soon!`,
    footer: 'Basilisk',
  });

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription("Look up a player's stats for a specific game.")
    .addStringOption((option) =>
      option
        .setName('game')
        .setDescription('Which game to look up')
        .setRequired(true)
        .addChoices(
          { name: 'League of Legends', value: 'league' },
          { name: 'Valorant', value: 'valorant' },
          { name: 'Overwatch 2', value: 'overwatch' },
          { name: 'Rocket League', value: 'rocketleague' },
          { name: 'Marvel Rivals', value: 'marvelrivals' },
          { name: 'Super Smash Bros. Ultimate', value: 'smash' },
        )
    )
    .addStringOption((option) =>
      option
        .setName('username')
        .setDescription('Player identifier - format depends on the game (e.g. Name#TAG for Riot games)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('region')
        .setDescription('Server region - only used for League of Legends and Valorant (defaults to NA)')
        .addChoices(
          { name: 'North America', value: 'na' },
          { name: 'EU West', value: 'euw' },
          { name: 'EU Nordic & East', value: 'eune' },
          { name: 'Korea', value: 'kr' },
          { name: 'Oceania', value: 'oce' },
        )
    ),

  async execute(interaction) {
    const gameKey = interaction.options.getString('game');
    const username = interaction.options.getString('username');
    const regionKey = interaction.options.getString('region') || 'na';

    await interaction.deferReply();

    switch (gameKey) {
      case 'league':
        await handleLeagueLookup(interaction, username, regionKey);
        break;
      case 'valorant':
        await handleValorantLookup(interaction, username);
        break;
      default:
        await handleNotYetSupported(interaction, gameKey, username);
        break;
    }
  },
};
