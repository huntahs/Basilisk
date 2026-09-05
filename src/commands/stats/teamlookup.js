const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { baseEmbed } = require('../../services/embeds');
const { getLeagueProfile, analyzeRecentRankedSolo } = require('../../services/riot');
const { getProfileIconUrl } = require('../../services/ddragon');

const MAX_PLAYERS = 5;
const CONDENSED_MATCH_COUNT = 10; // fewer than the full /lookup, to stay well under rate limits

// Lane display order, left to right: Top, Jungle, Mid, Bot, Support.
// Unknown/undetected lanes are pushed to the end.
const LANE_ORDER = ['Top', 'Jungle', 'Mid', 'Bot Lane', 'Support'];

const LANE_EMOJI = {
  Top: '🛡️',
  Jungle: '🌲',
  Mid: '⚔️',
  'Bot Lane': '🏹',
  Support: '❤️‍🩹',
};

// op.gg region codes match our own region keys 1:1 (na, euw, eune, kr, oce).
const OPGG_REGION = {
  na: 'na',
  euw: 'euw',
  eune: 'eune',
  kr: 'kr',
  oce: 'oce',
};

// Same rank-tier accent colors as /lookup, plus an ordering so we can pick
// the team's single highest rank to color the embed with.
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
const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

function laneSortIndex(lane) {
  const index = LANE_ORDER.indexOf(lane);
  return index === -1 ? LANE_ORDER.length : index;
}

function formatRank(entry) {
  if (!entry) return 'Unranked';
  const tier = entry.tier.charAt(0) + entry.tier.slice(1).toLowerCase();
  return `${tier} ${entry.rank} - ${entry.leaguePoints} LP`;
}

function formatWinRate(entry) {
  if (!entry) return null;
  const total = entry.wins + entry.losses;
  if (total === 0) return null;
  return `${Math.round((entry.wins / total) * 100)}% (${entry.wins}W ${entry.losses}L)`;
}

async function lookupOnePlayer(riotIdInput, regionKey) {
  const [gameName, tagLine] = riotIdInput.split('#').map((s) => s?.trim());
  if (!gameName || !tagLine) {
    return { riotId: riotIdInput, error: 'Invalid Riot ID format (use Name#TAG).' };
  }

  try {
    const profile = await getLeagueProfile(gameName, tagLine, regionKey);
    const soloEntry = profile.rankedEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
    const trends = await analyzeRecentRankedSolo(profile.puuid, profile.regionalRoute, CONDENSED_MATCH_COUNT);

    const winRateText = formatWinRate(soloEntry);

    return {
      riotId: profile.riotId,
      lane: trends.topLane, // may be null/undefined if no recent ranked games
      rankText: formatRank(soloEntry),
      winRateText,
      topChampions: trends.topChampions, // array of { name, winRate, ... }
      tier: soloEntry?.tier || null,
      profileIconId: profile.profileIconId,
    };
  } catch (error) {
    console.error(`Error looking up ${riotIdInput} for /teamlookup:`, error);
    return { riotId: riotIdInput, error: "Couldn't load this player's data." };
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamlookup')
    .setDescription('Look up up to 5 League players at once, sorted by lane.')
    .addStringOption((option) =>
      option
        .setName('riot-ids')
        .setDescription(`Comma-separated Riot IDs, e.g. Name1#TAG1, Name2#TAG2 (up to ${MAX_PLAYERS})`)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('region')
        .setDescription('Server all these players are on (defaults to NA)')
        .addChoices(
          { name: 'North America', value: 'na' },
          { name: 'EU West', value: 'euw' },
          { name: 'EU Nordic & East', value: 'eune' },
          { name: 'Korea', value: 'kr' },
          { name: 'Oceania', value: 'oce' },
        )
    ),

  async execute(interaction) {
    const rawInput = interaction.options.getString('riot-ids');
    const regionKey = interaction.options.getString('region') || 'na';

    const riotIds = rawInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_PLAYERS);

    if (riotIds.length === 0) {
      await interaction.reply({
        content: 'Give me at least one Riot ID (e.g. `Name#TAG`).',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    // Players are looked up one at a time (not in parallel) - this is
    // intentional. Running 5 lookups concurrently would burst way more
    // requests per second than Riot's rate limit allows; going sequential
    // keeps request pacing predictable even though it's slower overall.
    const results = [];
    for (const riotId of riotIds) {
      results.push(await lookupOnePlayer(riotId, regionKey));
    }

    results.sort((a, b) => laneSortIndex(a.lane) - laneSortIndex(b.lane));

    const embed = baseEmbed({
      title: `🎮 League of Legends — Team Lookup (${results.length} players)`,
      footer: 'Data via Riot Games API • Sorted by lane, left to right',
    });

    // Color + thumbnail reflect whichever player on the team has the
    // highest current rank - a small "team captain" touch.
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
        const iconUrl = await getProfileIconUrl(bestPlayer.profileIconId);
        embed.setThumbnail(iconUrl);
      } catch (iconError) {
        console.error('Error fetching team thumbnail icon:', iconError);
      }
    }

    for (const result of results) {
      const laneLabel = result.lane || 'Unknown Lane';
      const laneEmoji = LANE_EMOJI[result.lane] || '❓';

      if (result.error) {
        embed.addFields({
          name: `${laneEmoji} ${laneLabel} — ${result.riotId}`,
          value: result.error,
          inline: true,
        });
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

    // op.gg multisearch button - League specifically supports a combined
    // multisearch URL for multiple summoners at once. Other games don't have
    // an equivalent, so if/when this command supports them too, those will
    // need individual per-player profile link buttons instead of one shared one.
    const validRiotIds = results.filter((r) => !r.error).map((r) => r.riotId);
    if (validRiotIds.length > 0) {
      const opggRegion = OPGG_REGION[regionKey] || 'na';
      const encodedSummoners = validRiotIds.map((id) => encodeURIComponent(id)).join('%2C');
      const multisearchUrl = `https://op.gg/lol/multisearch/${opggRegion}?summoners=${encodedSummoners}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🔗 View Team on op.gg ↗')
          .setStyle(ButtonStyle.Link)
          .setURL(multisearchUrl)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
