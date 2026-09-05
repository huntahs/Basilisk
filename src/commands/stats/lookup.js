const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { baseEmbed } = require('../../services/embeds');
const { getLeagueProfile, analyzeRecentRankedSolo, getTopChampionMastery, RiotApiError } = require('../../services/riot');
const { getChampionName, getProfileIconUrl } = require('../../services/ddragon');
const { getPlayerStats, findPlaylist, RocketLeagueApiError, PLAYLIST_IDS } = require('../../services/rocketleague');
const { buildChartUrl } = require('../../services/quickchart');
const { getAccount, getMMR, getRecentCompetitiveMatches, analyzeCompetitiveMatches, HenrikApiError } = require('../../services/henrikValorant');
const { getAgentRoleMap } = require('../../services/valorantContent');
const { getPlayerSummary, getPlayerStatsSummary, getHeroRoleMap, pickDominantPlatform, groupHeroesByRole, findMostPlayedRole, formatPlaytime, ROLE_KEYS, OverfastApiError } = require('../../services/overfast');

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

// HenrikDev returns Valorant season codes like "e10a6" (Episode 10, Act 6)
// instead of a human-readable name. Decode it if it matches that pattern,
// otherwise just show whatever raw value came back rather than guessing.
function formatValorantSeason(code) {
  if (!code) return 'unknown act';
  const match = code.match(/^e(\d+)a(\d+)$/i);
  if (!match) return code;
  const [, episode, act] = match;
  return `Episode ${episode}, Act ${act}`;
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
 * Rocket League lookup. Confirmed working via RapidAPI's "rocket-league10"
 * stats endpoint. NOTE: this API only exposes lifetime career totals for
 * goals/assists/saves - there's no per-match/recent-games data available,
 * so the playstyle chart reflects the player's whole career, not a recent
 * sample (unlike /lookup's League trends, which use a real 20-game window).
 */
async function handleRocketLeagueLookup(interaction, username, platformKey) {
  try {
    const data = await getPlayerStats(platformKey, username);

    const embed = baseEmbed({
      title: `Rocket League — ${data.username}`,
      footer: 'Data via Rocket League Stats API (RapidAPI)',
    });

    const doubles = findPlaylist(data, PLAYLIST_IDS.DOUBLES_2V2);
    const standard = findPlaylist(data, PLAYLIST_IDS.STANDARD_3V3);

    function playlistField(label, playlist) {
      if (!playlist) {
        return { name: label, value: 'No data for this playlist.', inline: true };
      }
      return {
        name: label,
        value:
          `${playlist.tier} ${playlist.division} (${playlist.rating} MMR)\n` +
          `Peak: ${playlist.peakTier} ${playlist.peakDivision} (${playlist.peakRating})`,
        inline: true,
      };
    }

    embed.addFields(
      playlistField('🥅 2v2 (Doubles)', doubles),
      playlistField('🥅 3v3 (Standard)', standard),
      { name: '\u200b', value: '\u200b', inline: true },
    );

    if (data.lifetime) {
      const { goals, assists, saves } = data.lifetime;
      const total = goals + assists + saves;
      const pct = (value) => ((value / total) * 100).toFixed(1);

      const chartUrl = buildChartUrl({
        type: 'pie',
        data: {
          labels: [
            `Goals: ${pct(goals)}%`,
            `Assists: ${pct(assists)}%`,
            `Saves: ${pct(saves)}%`,
          ],
          datasets: [{
            data: [goals, assists, saves],
            backgroundColor: ['#c0392b', '#2980b9', '#27ae60'],
          }],
        },
        options: {
          plugins: {
            title: { display: true, text: 'Playstyle - Lifetime Totals' },
            legend: { position: 'bottom' },
          },
        },
      });
      embed.setImage(chartUrl);

      embed.addFields({
        name: '📊 Lifetime Totals',
        value: `Goals: **${goals.toLocaleString()}** (${pct(goals)}%)  •  Assists: **${assists.toLocaleString()}** (${pct(assists)}%)  •  Saves: **${saves.toLocaleString()}** (${pct(saves)}%)`,
      });
    }

    // Best-guess Tracker Network profile URL format - unverified beyond
    // general convention. Confirm/adjust once tested against a real profile.
    const trackerUrl = `https://rocketleague.tracker.network/rocket-league/profile/${platformKey}/${encodeURIComponent(username)}/overview`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔗 Full Stats on Tracker Network ↗')
        .setStyle(ButtonStyle.Link)
        .setURL(trackerUrl)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    if (error instanceof RocketLeagueApiError) {
      await interaction.editReply(`Couldn't get that player's data: ${error.message}`);
      return;
    }
    throw error;
  }
}

/**
 * Valorant lookup - real data via HenrikDev's unofficial Valorant API.
 * `username` is expected in Riot ID format: Name#TAG
 */
async function handleValorantLookup(interaction, username) {
  const [name, tag] = username.split('#').map((s) => s?.trim());
  if (!name || !tag) {
    await interaction.editReply(
      'That doesn\'t look like a valid Riot ID. Use the format `Name#TAG` (e.g. `Gyroscopic#Spin`).'
    );
    return;
  }

  try {
    const account = await getAccount(name, tag);
    const region = account.region;

    const embed = baseEmbed({
      title: `Valorant — ${account.name}#${account.tag}`,
      description: `Region: ${region.toUpperCase()} • Level ${account.account_level}`,
      footer: 'Data via HenrikDev API',
    });

    if (account.card?.small) {
      embed.setThumbnail(account.card.small);
    }

    // --- Current rating ---
    try {
      const mmr = await getMMR(region, name, tag);
      embed.addFields({
        name: '🏆 Current Rating',
        value: `${mmr.current_data?.currenttierpatched || 'Unranked'} (${mmr.current_data?.elo ?? '?'} ELO)`,
        inline: true,
      });
      if (mmr.highest_rank?.patched_tier) {
        embed.addFields({
          name: '⭐ Peak Rank',
          value: `${mmr.highest_rank.patched_tier} (${formatValorantSeason(mmr.highest_rank.season)})`,
          inline: true,
        });
      }
      embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
    } catch (mmrError) {
      console.error('Error fetching Valorant MMR:', mmrError);
      embed.addFields({ name: '🏆 Current Rating', value: "Couldn't load right now." });
    }

    // --- Match analysis: win/loss, K/D, agents, roles, weapons, maps ---
    try {
      const matches = await getRecentCompetitiveMatches(region, name, tag);
      const roleMap = await getAgentRoleMap();
      const analysis = analyzeCompetitiveMatches(matches, account.puuid, roleMap);

      if (analysis.gamesAnalyzed === 0) {
        embed.addFields({
          name: '📊 Recent Competitive Matches',
          value: 'No recent competitive matches found.',
        });
      } else {
        embed.addFields({
          name: '📊 Recent Match Stats',
          value: `*Everything below (K/D, agents, roles, weapons, maps) is based on your last **${analysis.gamesAnalyzed}** competitive games only - not your full history.*`,
        });

        embed.addFields({
          name: '📈 Win/Loss',
          value: `${analysis.winRatePct}% win rate (${analysis.wins}W ${analysis.losses}L)`,
        });

        embed.addFields({
          name: '🎯 K/D Ratio',
          value: analysis.kdRatio === null
            ? `Perfect (${analysis.totalKills}K / 0D)`
            : `${analysis.kdRatio} (${analysis.totalKills}K ${analysis.totalDeaths}D ${analysis.totalAssists}A)`,
        });

        for (const agent of analysis.topAgents) {
          embed.addFields({
            name: `⚔️ Most Played: ${agent.name}`,
            value: `${agent.games} games • ${agent.winRate}% win rate (${agent.wins}W ${agent.losses}L)`,
            inline: true,
          });
        }

        if (analysis.topRoles.length > 0) {
          embed.addFields({
            name: '🛡️ Most Played Roles',
            value: analysis.topRoles.map((r) => `${r.role} (${r.pct}%)`).join('  •  '),
          });
        }

        if (analysis.topWeapons.length > 0) {
          embed.addFields({
            name: '🔫 Most Used Weapons',
            value: analysis.topWeapons.map((w) => `${w.name} — ${w.kills} kills`).join('\n'),
          });
        }

        if (analysis.mapStats.length > 0) {
          const mapLines = analysis.mapStats.map(
            (m) => `**${m.map}**: ${m.winRate}% WR (${m.wins}W ${m.losses}L) • Top agents: ${m.topAgents.join(', ')}`
          );
          embed.addFields({
            name: '🗺️ Map Stats',
            value: mapLines.join('\n'),
          });
        }
      }
    } catch (analysisError) {
      console.error('Error analyzing Valorant matches:', analysisError);
      embed.addFields({
        name: '📊 Recent Competitive Matches',
        value: "Couldn't load right now - try again shortly.",
      });
    }

    // Tracker Network profile link - format confirmed from a real profile
    // URL shared earlier in this project's development.
    const trackerUrl = `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(name)}%23${encodeURIComponent(tag)}/overview?platform=pc&playlist=competitive`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔗 Full Stats on Tracker Network ↗')
        .setStyle(ButtonStyle.Link)
        .setURL(trackerUrl)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    if (error instanceof HenrikApiError) {
      await interaction.editReply(`Couldn't get that player's data: ${error.message}`);
      return;
    }
    throw error;
  }
}

/**
 * Overwatch 2 lookup - real data via the OverFast API.
 * `username` is expected as a BattleTag with # replaced by - (e.g. Name-1234),
 * matching this API's own identifier convention.
 *
 * Automatically picks whichever platform (PC or console) the player has
 * more competitive games on, and uses that platform's rank + stats
 * throughout the whole embed.
 *
 * NOTE: this API only exposes lifetime/season-aggregate stats, not a
 * "last N games" rolling window (same limitation as Rocket League) - the
 * embed is upfront about that rather than implying otherwise.
 */
const OW_ROLE_DISPLAY_NAMES = { tank: 'Tank', damage: 'DPS', support: 'Support' };

async function handleOverwatchLookup(interaction, username) {
  try {
    const summary = await getPlayerSummary(username);

    const embed = baseEmbed({
      title: `Overwatch 2 — ${summary.username}`,
      footer: 'Data via OverFast API • All stats are lifetime/season totals, not a recent-games sample',
    });

    if (summary.avatar) {
      embed.setThumbnail(summary.avatar);
    }

    // --- Fetch both platforms' stats in parallel, pick the dominant one ---
    let dominantPlatform = 'pc';
    let stats = null;
    let heroRoleMap = null;

    try {
      const [pcStats, consoleStats, roleMap] = await Promise.all([
        getPlayerStatsSummary(username, { platform: 'pc' }).catch(() => null),
        getPlayerStatsSummary(username, { platform: 'console' }).catch(() => null),
        getHeroRoleMap(),
      ]);
      dominantPlatform = pickDominantPlatform(pcStats, consoleStats);
      stats = dominantPlatform === 'console' ? consoleStats : pcStats;
      heroRoleMap = roleMap;
    } catch (statsError) {
      console.error('Error fetching Overwatch stats summary:', statsError);
    }

    embed.setDescription(`Platform: **${dominantPlatform === 'console' ? 'Console' : 'PC'}** (more competitive games played here)`);

    // --- Rank + WR + KDA per role ---
    const ranks = summary.competitive?.[dominantPlatform];
    for (const roleKey of ROLE_KEYS) {
      const rank = ranks?.[roleKey];
      const roleStats = stats?.roles?.[roleKey];
      const displayName = OW_ROLE_DISPLAY_NAMES[roleKey];

      if (!rank && !roleStats) continue; // never played this role at all

      const rankLine = rank
        ? `${rank.division.charAt(0).toUpperCase() + rank.division.slice(1)} ${rank.tier}`
        : 'Unranked';
      const wrLine = roleStats ? `${Math.round(roleStats.winrate)}%` : 'N/A';
      const kdaLine = roleStats ? `${roleStats.kda}` : 'N/A';

      embed.addFields({
        name: `🏆 ${displayName} Rank`,
        value: `${rankLine}\nWR: ${wrLine} • KDA: ${kdaLine}`,
        inline: true,
      });
    }

    // --- Most played role ---
    const mostPlayedRole = findMostPlayedRole(stats?.roles);
    if (mostPlayedRole) {
      embed.addFields({
        name: '🎯 Role Most Played',
        value: OW_ROLE_DISPLAY_NAMES[mostPlayedRole],
      });
    }

    // --- Top 2 heroes per role ---
    if (stats?.heroes && heroRoleMap) {
      const grouped = groupHeroesByRole(stats.heroes, heroRoleMap, 2);
      for (const roleKey of ROLE_KEYS) {
        const heroes = grouped[roleKey];
        if (!heroes || heroes.length === 0) continue;

        const lines = heroes.map((h) => {
          const heroName = h.name.charAt(0).toUpperCase() + h.name.slice(1);
          return `**${heroName}** — ${h.winRate}% WR • ${formatPlaytime(h.timePlayed)} played`;
        });

        embed.addFields({
          name: `⚔️ Top ${OW_ROLE_DISPLAY_NAMES[roleKey]} Heroes`,
          value: lines.join('\n'),
          inline: true,
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    if (error instanceof OverfastApiError) {
      await interaction.editReply(`Couldn't get that player's data: ${error.message}`);
      return;
    }
    throw error;
  }
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


const REGION_CHOICES = [
  { name: 'North America', value: 'na' },
  { name: 'EU West', value: 'euw' },
  { name: 'EU Nordic & East', value: 'eune' },
  { name: 'Korea', value: 'kr' },
  { name: 'Oceania', value: 'oce' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription("Look up a player's stats for a specific game.")
    .addSubcommand((sub) =>
      sub
        .setName('league')
        .setDescription("Look up a player's League of Legends stats.")
        .addStringOption((option) =>
          option.setName('username').setDescription('Riot ID, e.g. Name#TAG').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('region').setDescription('Server region (defaults to NA)').addChoices(...REGION_CHOICES)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('valorant')
        .setDescription("Look up a player's Valorant stats.")
        .addStringOption((option) =>
          option.setName('username').setDescription('Riot ID, e.g. Name#TAG').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('region').setDescription('Server region (defaults to NA)').addChoices(...REGION_CHOICES)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('rocketleague')
        .setDescription("Look up a player's Rocket League stats.")
        .addStringOption((option) =>
          option.setName('username').setDescription('Player username').setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('platform')
            .setDescription('Platform (defaults to Epic Games)')
            .addChoices(
              { name: 'Epic Games', value: 'epic' },
              { name: 'Steam', value: 'steam' },
              { name: 'Xbox', value: 'xbl' },
              { name: 'PlayStation', value: 'psn' },
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('overwatch')
        .setDescription("Look up a player's Overwatch 2 stats.")
        .addStringOption((option) =>
          option
            .setName('username')
            .setDescription('BattleTag with # replaced by - (e.g. Name-1234)')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('marvelrivals')
        .setDescription("Look up a player's Marvel Rivals stats.")
        .addStringOption((option) =>
          option.setName('username').setDescription('Player username').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('smash')
        .setDescription("Look up a player's Super Smash Bros. Ultimate stats.")
        .addStringOption((option) =>
          option.setName('username').setDescription('Player username').setRequired(true)
        )
    ),

  async execute(interaction) {
    const gameKey = interaction.options.getSubcommand();
    const username = interaction.options.getString('username');

    await interaction.deferReply();

    switch (gameKey) {
      case 'league':
        await handleLeagueLookup(interaction, username, interaction.options.getString('region') || 'na');
        break;
      case 'valorant':
        await handleValorantLookup(interaction, username);
        break;
      case 'rocketleague':
        await handleRocketLeagueLookup(interaction, username, interaction.options.getString('platform') || 'epic');
        break;
      case 'overwatch':
        await handleOverwatchLookup(interaction, username);
        break;
      default:
        await handleNotYetSupported(interaction, gameKey, username);
        break;
    }
  },
};
