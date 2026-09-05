const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { baseEmbed } = require('../../services/embeds');
const { getLeagueProfile, analyzeRecentRankedSolo } = require('../../services/riot');
const { getProfileIconUrl } = require('../../services/ddragon');
const { getAccount, getMMR, getRecentCompetitiveMatches, analyzeCompetitiveMatches } = require('../../services/henrikValorant');
const { getAgentRoleMap } = require('../../services/valorantContent');
const { getPlayerStats, findPlaylist, PLAYLIST_IDS } = require('../../services/rocketleague');
const {
  getPlayerSummary,
  getPlayerStatsSummary,
  getHeroRoleMap,
  pickDominantPlatform,
  groupHeroesByRole,
  findMostPlayedRole,
} = require('../../services/overfast');
const { getSmashTeamSummary } = require('../../services/startgg');

const MAX_PLAYERS = 5;
const CONDENSED_MATCH_COUNT = 5; // reduced further after hitting rate limits even at 10 - Riot's match-detail endpoint seems to have a stricter per-method limit than the general app-wide limits suggest

function parsePlayerList(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PLAYERS);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared runner for the 4 non-League games: looks up each player
 * sequentially (not in parallel - intentional, keeps request pacing
 * predictable instead of bursting each API's rate limit), sorts the
 * results, builds one embed PER PLAYER (Discord allows up to 10 embeds in
 * a single message, so up to 5 players fits comfortably), and adds
 * individual link buttons for whichever players don't have a lookup error.
 */
async function runMultiEmbedTeamLookup(interaction, { inputs, lookupFn, buildEmbedFn, sortFn, buildButtonFn }) {
  await interaction.deferReply();

  const results = [];
  for (const input of inputs) {
    results.push(await lookupFn(input));
    await delay(2000); // increased after hitting rate limits even at 500ms - being conservative since we don't have full visibility into Riot's exact per-method limits
  }

  if (sortFn) results.sort(sortFn);

  const embeds = results.map(buildEmbedFn).slice(0, 10);

  const buttons = [];
  if (buildButtonFn) {
    for (const result of results) {
      if (result.error) continue;
      const button = buildButtonFn(result);
      if (button) buttons.push(button);
    }
  }

  const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] : [];

  await interaction.editReply({ embeds, components });
}

// ============================================================
// LEAGUE OF LEGENDS - existing implementation, sorted by lane,
// one shared op.gg multisearch button (League-specific feature).
// ============================================================

const LANE_ORDER = ['Top', 'Jungle', 'Mid', 'Bot Lane', 'Support'];
const LANE_EMOJI = { Top: '🛡️', Jungle: '🌲', Mid: '⚔️', 'Bot Lane': '🏹', Support: '❤️‍🩹' };
const OPGG_REGION = { na: 'na', euw: 'euw', eune: 'eune', kr: 'kr', oce: 'oce' };
const TIER_COLORS = {
  IRON: 0x51484a, BRONZE: 0x8a5a3b, SILVER: 0x9aa5ab, GOLD: 0xc89b3c, PLATINUM: 0x2ea6a6,
  EMERALD: 0x2f9e5f, DIAMOND: 0x576bcf, MASTER: 0x9d4ed9, GRANDMASTER: 0xc9425a, CHALLENGER: 0xf4e26b,
};
const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

function laneSortIndex(lane) {
  const index = LANE_ORDER.indexOf(lane);
  return index === -1 ? LANE_ORDER.length : index;
}

function formatLeagueRank(entry) {
  if (!entry) return 'Unranked';
  const tier = entry.tier.charAt(0) + entry.tier.slice(1).toLowerCase();
  return `${tier} ${entry.rank} - ${entry.leaguePoints} LP`;
}

function formatLeagueWinRate(entry) {
  if (!entry) return null;
  const total = entry.wins + entry.losses;
  if (total === 0) return null;
  return `${Math.round((entry.wins / total) * 100)}% (${entry.wins}W ${entry.losses}L)`;
}

async function lookupOneLeaguePlayer(riotIdInput, regionKey) {
  const [gameName, tagLine] = riotIdInput.split('#').map((s) => s?.trim());
  if (!gameName || !tagLine) {
    return { riotId: riotIdInput, error: 'Invalid Riot ID format (use Name#TAG).' };
  }
  try {
    const profile = await getLeagueProfile(gameName, tagLine, regionKey);
    const soloEntry = profile.rankedEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
    const trends = await analyzeRecentRankedSolo(profile.puuid, profile.regionalRoute, CONDENSED_MATCH_COUNT);

    return {
      riotId: profile.riotId,
      lane: trends.topLane,
      rankText: formatLeagueRank(soloEntry),
      winRateText: formatLeagueWinRate(soloEntry),
      topChampions: trends.topChampions,
      tier: soloEntry?.tier || null,
      profileIconId: profile.profileIconId,
    };
  } catch (error) {
    console.error(`Error looking up ${riotIdInput} for /teamlookup league:`, error);
    return { riotId: riotIdInput, error: "Couldn't load this player's data." };
  }
}

async function handleLeagueTeamLookup(interaction) {
  const rawInput = interaction.options.getString('riot-ids');
  const regionKey = interaction.options.getString('region') || 'na';
  const riotIds = parsePlayerList(rawInput);

  if (riotIds.length === 0) {
    await interaction.reply({ content: 'Give me at least one Riot ID (e.g. `Name#TAG`).', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const results = [];
  for (const riotId of riotIds) {
    results.push(await lookupOneLeaguePlayer(riotId, regionKey));
    await delay(2000); // increased after hitting rate limits even at 500ms - being conservative since we don't have full visibility into Riot's exact per-method limits
  }
  results.sort((a, b) => laneSortIndex(a.lane) - laneSortIndex(b.lane));

  const embed = baseEmbed({
    title: `🎮 League of Legends — Team Lookup (${results.length} players)`,
    footer: 'Basilisk • Sorted by lane, left to right',
  });

  let bestPlayer = null;
  let bestTierIndex = -1;
  for (const result of results) {
    if (result.error || !result.tier) continue;
    const tierIndex = TIER_ORDER.indexOf(result.tier);
    if (tierIndex > bestTierIndex) {
      bestTierIndex = tierIndex;
      bestPlayer = result;
    }
  }
  if (bestPlayer && TIER_COLORS[bestPlayer.tier]) {
    embed.setColor(TIER_COLORS[bestPlayer.tier]);
  }
  if (bestPlayer?.profileIconId) {
    try {
      embed.setThumbnail(await getProfileIconUrl(bestPlayer.profileIconId));
    } catch (iconError) {
      console.error('Error fetching team thumbnail icon:', iconError);
    }
  }

  for (const result of results) {
    const laneLabel = result.lane || 'Unknown Lane';
    const laneEmoji = LANE_EMOJI[result.lane] || '❓';

    if (result.error) {
      embed.addFields({ name: `${laneEmoji} ${laneLabel} — ${result.riotId}`, value: result.error, inline: true });
    } else {
      const winRateLine = result.winRateText || 'N/A';
      const championLines = result.topChampions.length > 0
        ? result.topChampions.map((c) => `${c.name} — ${c.winRate}%`).join('\n')
        : 'No recent ranked games';
      embed.addFields({
        name: `${laneEmoji} ${laneLabel} — ${result.riotId}`,
        value: `${result.rankText}\n${winRateLine}\n\n${championLines}`,
        inline: true,
      });
    }
  }

  const validRiotIds = results.filter((r) => !r.error).map((r) => r.riotId);
  if (validRiotIds.length > 0) {
    const opggRegion = OPGG_REGION[regionKey] || 'na';
    const encodedSummoners = validRiotIds.map((id) => encodeURIComponent(id)).join('%2C');
    const multisearchUrl = `https://op.gg/lol/multisearch/${opggRegion}?summoners=${encodedSummoners}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🔗 View Team on op.gg ↗').setStyle(ButtonStyle.Link).setURL(multisearchUrl)
    );
    await interaction.editReply({ embeds: [embed], components: [row] });
  } else {
    await interaction.editReply({ embeds: [embed] });
  }
}

// ============================================================
// VALORANT - sorted by primary role, individual Tracker Network
// link buttons (no multisearch equivalent exists for this game).
// ============================================================

const VALORANT_ROLE_ORDER = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
function valorantRoleSortIndex(role) {
  const index = VALORANT_ROLE_ORDER.indexOf(role);
  return index === -1 ? VALORANT_ROLE_ORDER.length : index;
}

async function lookupOneValorantPlayer(riotIdInput) {
  const [name, tag] = riotIdInput.split('#').map((s) => s?.trim());
  if (!name || !tag) {
    return { riotId: riotIdInput, error: 'Invalid Riot ID format (use Name#TAG).', role: null };
  }
  try {
    const account = await getAccount(name, tag);
    const region = account.region;
    const mmr = await getMMR(region, name, tag);
    const matches = await getRecentCompetitiveMatches(region, name, tag);
    const roleMap = await getAgentRoleMap();
    const analysis = analyzeCompetitiveMatches(matches, account.puuid, roleMap);
    const primaryRole = analysis.topRoles?.[0]?.role || null;
    const topAgent = analysis.topAgents?.[0] || null;

    return {
      riotId: `${account.gameName}#${account.tagLine}`,
      role: primaryRole,
      rankText: mmr.current_data?.currenttierpatched || 'Unranked',
      winRateText: analysis.gamesAnalyzed > 0 ? `${analysis.winRatePct}% (${analysis.wins}W ${analysis.losses}L)` : 'N/A',
      topAgentText: topAgent ? `${topAgent.name} (${topAgent.winRate}% WR)` : 'No recent games',
      trackerUrl: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(name)}%23${encodeURIComponent(tag)}/overview?platform=pc&playlist=competitive`,
    };
  } catch (error) {
    console.error(`Error looking up ${riotIdInput} for /teamlookup valorant:`, error);
    return { riotId: riotIdInput, error: "Couldn't load this player's data.", role: null };
  }
}

function buildValorantEmbed(result) {
  if (result.error) {
    return baseEmbed({ title: `Valorant — ${result.riotId}`, description: result.error });
  }
  return baseEmbed({
    title: `Valorant — ${result.riotId}`,
    description: `**Role:** ${result.role || 'Unknown'}`,
  }).addFields(
    { name: '🏆 Rating', value: result.rankText, inline: true },
    { name: '📈 Win Rate', value: result.winRateText, inline: true },
    { name: '⚔️ Top Agent', value: result.topAgentText, inline: true },
  );
}

async function handleValorantTeamLookup(interaction) {
  const inputs = parsePlayerList(interaction.options.getString('riot-ids'));
  if (inputs.length === 0) {
    await interaction.reply({ content: 'Give me at least one Riot ID (e.g. `Name#TAG`).', ephemeral: true });
    return;
  }
  await runMultiEmbedTeamLookup(interaction, {
    inputs,
    lookupFn: lookupOneValorantPlayer,
    buildEmbedFn: buildValorantEmbed,
    sortFn: (a, b) => valorantRoleSortIndex(a.role) - valorantRoleSortIndex(b.role),
    buildButtonFn: (r) => new ButtonBuilder().setLabel(`🔗 ${r.riotId}`).setStyle(ButtonStyle.Link).setURL(r.trackerUrl),
  });
}

// ============================================================
// OVERWATCH 2 - sorted by role (Tank/DPS/Support). No link button:
// no verified external profile URL exists for this integration yet.
// ============================================================

const OW_ROLE_ORDER = ['tank', 'damage', 'support'];
const OW_ROLE_DISPLAY = { tank: 'Tank', damage: 'DPS', support: 'Support' };
function owRoleSortIndex(role) {
  const index = OW_ROLE_ORDER.indexOf(role);
  return index === -1 ? OW_ROLE_ORDER.length : index;
}

async function lookupOneOverwatchPlayer(rawUsername) {
  const username = rawUsername.replace('#', '-');
  try {
    const summary = await getPlayerSummary(username);
    const [pcStats, consoleStats, roleMap] = await Promise.all([
      getPlayerStatsSummary(username, { platform: 'pc' }).catch(() => null),
      getPlayerStatsSummary(username, { platform: 'console' }).catch(() => null),
      getHeroRoleMap(),
    ]);
    const dominantPlatform = pickDominantPlatform(pcStats, consoleStats);
    const stats = dominantPlatform === 'console' ? consoleStats : pcStats;

    const primaryRole = findMostPlayedRole(stats?.roles);
    const rank = primaryRole ? summary.competitive?.[dominantPlatform]?.[primaryRole] : null;
    const rankText = rank ? `${rank.division.charAt(0).toUpperCase() + rank.division.slice(1)} ${rank.tier}` : 'Unranked';

    const grouped = stats?.heroes ? groupHeroesByRole(stats.heroes, roleMap, 1) : null;
    const topHero = primaryRole && grouped ? grouped[primaryRole]?.[0] : null;
    const topHeroText = topHero
      ? `${topHero.name.charAt(0).toUpperCase() + topHero.name.slice(1)} (${topHero.winRate}% WR)`
      : 'No data';

    return {
      username: summary.username,
      role: primaryRole,
      rankText,
      topHeroText,
    };
  } catch (error) {
    console.error(`Error looking up ${rawUsername} for /teamlookup overwatch:`, error);
    return { username: rawUsername, error: "Couldn't load this player's data.", role: null };
  }
}

function buildOverwatchEmbed(result) {
  if (result.error) {
    return baseEmbed({ title: `Overwatch 2 — ${result.username}`, description: result.error });
  }
  const roleLabel = result.role ? OW_ROLE_DISPLAY[result.role] : 'Unknown Role';
  return baseEmbed({
    title: `Overwatch 2 — ${result.username}`,
    description: `**Role:** ${roleLabel}`,
  }).addFields(
    { name: '🏆 Rank', value: result.rankText, inline: true },
    { name: '⚔️ Top Hero', value: result.topHeroText, inline: true },
  );
}

async function handleOverwatchTeamLookup(interaction) {
  const inputs = parsePlayerList(interaction.options.getString('battletags'));
  if (inputs.length === 0) {
    await interaction.reply({ content: 'Give me at least one BattleTag (e.g. `Name#1234` or `Name-1234`).', ephemeral: true });
    return;
  }
  await runMultiEmbedTeamLookup(interaction, {
    inputs,
    lookupFn: lookupOneOverwatchPlayer,
    buildEmbedFn: buildOverwatchEmbed,
    sortFn: (a, b) => owRoleSortIndex(a.role) - owRoleSortIndex(b.role),
    buildButtonFn: null, // no verified external profile link for Overwatch yet
  });
}

// ============================================================
// ROCKET LEAGUE - sorted by 3v3 rating (highest first, no role
// concept exists), individual Tracker Network link buttons.
// ============================================================

async function lookupOneRocketLeaguePlayer(username, platformKey) {
  try {
    const data = await getPlayerStats(platformKey, username);
    const doubles = findPlaylist(data, PLAYLIST_IDS.DOUBLES_2V2);
    const standard = findPlaylist(data, PLAYLIST_IDS.STANDARD_3V3);

    return {
      username: data.username,
      doublesText: doubles ? `${doubles.tier} ${doubles.division} (${doubles.rating})` : 'Unranked',
      standardText: standard ? `${standard.tier} ${standard.division} (${standard.rating})` : 'Unranked',
      sortRating: standard?.rating ?? -1,
      trackerUrl: `https://rocketleague.tracker.network/rocket-league/profile/${platformKey}/${encodeURIComponent(username)}/overview`,
    };
  } catch (error) {
    console.error(`Error looking up ${username} for /teamlookup rocketleague:`, error);
    return { username, error: "Couldn't load this player's data.", sortRating: -1 };
  }
}

function buildRocketLeagueEmbed(result) {
  if (result.error) {
    return baseEmbed({ title: `Rocket League — ${result.username}`, description: result.error });
  }
  return baseEmbed({ title: `Rocket League — ${result.username}` }).addFields(
    { name: '🥅 2v2 (Doubles)', value: result.doublesText, inline: true },
    { name: '🥅 3v3 (Standard)', value: result.standardText, inline: true },
  );
}

async function handleRocketLeagueTeamLookup(interaction) {
  const inputs = parsePlayerList(interaction.options.getString('usernames'));
  const platformKey = interaction.options.getString('platform') || 'epic';
  if (inputs.length === 0) {
    await interaction.reply({ content: 'Give me at least one username.', ephemeral: true });
    return;
  }
  await runMultiEmbedTeamLookup(interaction, {
    inputs,
    lookupFn: (username) => lookupOneRocketLeaguePlayer(username, platformKey),
    buildEmbedFn: buildRocketLeagueEmbed,
    sortFn: (a, b) => b.sortRating - a.sortRating,
    buildButtonFn: (r) => new ButtonBuilder().setLabel(`🔗 ${r.username}`).setStyle(ButtonStyle.Link).setURL(r.trackerUrl),
  });
}

// ============================================================
// SUPER SMASH BROS. ULTIMATE - no team-role concept (1v1 game),
// preserves input order. Last-year W/L + top 2 characters only
// (no recent tournament placements shown, per request). Individual
// start.gg profile link buttons.
// ============================================================

async function lookupOneSmashPlayer(slug) {
  try {
    const data = await getSmashTeamSummary(slug);
    const displayName = data.prefix ? `${data.prefix} | ${data.gamerTag}` : data.gamerTag;
    const wl = data.winLoss;

    return {
      displayName,
      winLossText: wl.total > 0 ? `${wl.winRatePct}% (${wl.wins}W ${wl.losses}L)` : 'No recent sets found',
      charactersText: data.topCharacters.length > 0
        ? data.topCharacters.map((c) => `${c.name} (${c.gamesPlayed} games)`).join('\n')
        : 'No character data found',
      startggProfileUrl: data.startggProfileUrl,
    };
  } catch (error) {
    console.error(`Error looking up ${slug} for /teamlookup smash:`, error);
    return { displayName: slug, error: "Couldn't load this player's data." };
  }
}

function buildSmashEmbed(result) {
  if (result.error) {
    return baseEmbed({ title: `Super Smash Bros. Ultimate — ${result.displayName}`, description: result.error });
  }
  return baseEmbed({ title: `Super Smash Bros. Ultimate — ${result.displayName}` }).addFields(
    { name: '📊 Last Year W/L', value: result.winLossText, inline: true },
    { name: '⚔️ Top 2 Characters (last year)', value: result.charactersText, inline: true },
  );
}

async function handleSmashTeamLookup(interaction) {
  const inputs = parsePlayerList(interaction.options.getString('slugs'));
  if (inputs.length === 0) {
    await interaction.reply({ content: 'Give me at least one start.gg profile slug.', ephemeral: true });
    return;
  }
  await runMultiEmbedTeamLookup(interaction, {
    inputs,
    lookupFn: lookupOneSmashPlayer,
    buildEmbedFn: buildSmashEmbed,
    sortFn: null, // no team-role concept - preserve input order
    buildButtonFn: (r) => new ButtonBuilder().setLabel(`🔗 ${r.displayName}`).setStyle(ButtonStyle.Link).setURL(r.startggProfileUrl),
  });
}

// ============================================================
// Command definition
// ============================================================

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamlookup')
    .setDescription('Look up up to 5 players at once for a specific game.')
    .addSubcommand((sub) =>
      sub
        .setName('league')
        .setDescription('Look up up to 5 League of Legends players, sorted by lane.')
        .addStringOption((o) => o.setName('riot-ids').setDescription(`Comma-separated Riot IDs (up to ${MAX_PLAYERS})`).setRequired(true))
        .addStringOption((o) =>
          o.setName('region').setDescription('Server region (defaults to NA)').addChoices(
            { name: 'North America', value: 'na' },
            { name: 'EU West', value: 'euw' },
            { name: 'EU Nordic & East', value: 'eune' },
            { name: 'Korea', value: 'kr' },
            { name: 'Oceania', value: 'oce' },
          )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('valorant')
        .setDescription('Look up up to 5 Valorant players, sorted by role.')
        .addStringOption((o) => o.setName('riot-ids').setDescription(`Comma-separated Riot IDs (up to ${MAX_PLAYERS})`).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('rocketleague')
        .setDescription('Look up up to 5 Rocket League players, sorted by rank.')
        .addStringOption((o) => o.setName('usernames').setDescription(`Comma-separated usernames (up to ${MAX_PLAYERS})`).setRequired(true))
        .addStringOption((o) =>
          o.setName('platform').setDescription('Platform (defaults to Epic Games)').addChoices(
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
        .setDescription('Look up up to 5 Overwatch 2 players, sorted by role.')
        .addStringOption((o) => o.setName('battletags').setDescription(`Comma-separated BattleTags (up to ${MAX_PLAYERS})`).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('smash')
        .setDescription('Look up up to 5 Smash Ultimate players (last-year stats).')
        .addStringOption((o) => o.setName('slugs').setDescription(`Comma-separated start.gg profile slugs (up to ${MAX_PLAYERS})`).setRequired(true))
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case 'league':
        await handleLeagueTeamLookup(interaction);
        break;
      case 'valorant':
        await handleValorantTeamLookup(interaction);
        break;
      case 'rocketleague':
        await handleRocketLeagueTeamLookup(interaction);
        break;
      case 'overwatch':
        await handleOverwatchTeamLookup(interaction);
        break;
      case 'smash':
        await handleSmashTeamLookup(interaction);
        break;
    }
  },
};
