const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../../services/embeds');
const { getLeagueProfile, analyzeRecentRankedSolo } = require('../../services/riot');

const MAX_PLAYERS = 5;
const CONDENSED_MATCH_COUNT = 10; // fewer than the full /league lookup, to stay well under rate limits

// Lane display order, left to right: Top, Jungle, Mid, Bot, Support.
// Unknown/undetected lanes are pushed to the end.
const LANE_ORDER = ['Top', 'Jungle', 'Mid', 'Bot Lane', 'Support'];

function laneSortIndex(lane) {
  const index = LANE_ORDER.indexOf(lane);
  return index === -1 ? LANE_ORDER.length : index;
}

function formatRank(entry) {
  if (!entry) return 'Unranked';
  const tier = entry.tier.charAt(0) + entry.tier.slice(1).toLowerCase();
  return `${tier} ${entry.rank} - ${entry.leaguePoints} LP`;
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
    const topChamp = trends.topChampions[0];

    return {
      riotId: profile.riotId,
      lane: trends.topLane, // may be null/undefined if no recent ranked games
      rankText: formatRank(soloEntry),
      topChampText: topChamp ? `${topChamp.name} (${topChamp.winRate}% WR)` : 'No recent ranked games',
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
      title: `League of Legends — Team Lookup (${results.length} players)`,
      footer: 'Data via Riot Games API • Sorted by lane, left to right',
    });

    for (const result of results) {
      const laneLabel = result.lane || 'Unknown Lane';
      if (result.error) {
        embed.addFields({
          name: `${laneLabel} — ${result.riotId}`,
          value: result.error,
          inline: true,
        });
      } else {
        embed.addFields({
          name: `${laneLabel} — ${result.riotId}`,
          value: `${result.rankText}\nTop Champion: ${result.topChampText}`,
          inline: true,
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
