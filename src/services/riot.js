// Wrapper around Riot's official API.
// Covers both League of Legends and Valorant, since both use the same
// Riot-account-wide identity system (Riot ID -> PUUID via account-v1).
//
// Riot's API uses two kinds of routing:
//   - "regional" routing (americas / asia / europe) for account-wide lookups
//   - "platform" routing (na1 / euw1 / kr / etc.) for game-specific data
//     like League summoner and ranked info
//
// A Riot API key must be sent as the X-Riot-Token header on every request.

const RIOT_API_KEY = process.env.RIOT_API_KEY;

const RANKED_SOLO_QUEUE_ID = 420;
const MATCH_ANALYSIS_COUNT = 20;

const LANE_LABELS = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'Bot Lane',
  UTILITY: 'Support',
};

// Maps a friendly region choice (shown in Discord slash command options) to
// the regional + platform routing values Riot's API actually needs.
const REGION_MAP = {
  na: { regional: 'americas', platform: 'na1', label: 'North America' },
  euw: { regional: 'europe', platform: 'euw1', label: 'EU West' },
  eune: { regional: 'europe', platform: 'eun1', label: 'EU Nordic & East' },
  kr: { regional: 'asia', platform: 'kr', label: 'Korea' },
  oce: { regional: 'americas', platform: 'oc1', label: 'Oceania' },
};

class RiotApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'RiotApiError';
    this.status = status;
  }
}

async function riotFetch(url) {
  if (!RIOT_API_KEY) {
    throw new RiotApiError('RIOT_API_KEY is not set in the environment.', 0);
  }

  const response = await fetch(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY },
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.status?.message || '';
    } catch {
      // response wasn't JSON - ignore and use status text only
    }

    if (response.status === 404) {
      throw new RiotApiError('Player not found.', 404);
    }
    if (response.status === 403 || response.status === 401) {
      throw new RiotApiError(
        `Riot API rejected the request (${response.status}). ${detail || 'Check that RIOT_API_KEY is current and not expired.'}`,
        response.status
      );
    }
    if (response.status === 429) {
      throw new RiotApiError('Rate limited by Riot API - try again in a moment.', 429);
    }

    throw new RiotApiError(`Riot API error ${response.status}: ${detail || response.statusText}`, response.status);
  }

  return response.json();
}

/**
 * Looks up a Riot-wide account (PUUID) from a Riot ID.
 * Works identically for League and Valorant players, since account identity
 * is shared across Riot games.
 */
async function getAccountByRiotId(gameName, tagLine, regionKey) {
  const region = REGION_MAP[regionKey];
  if (!region) {
    throw new RiotApiError(`Unknown region "${regionKey}".`, 0);
  }

  const encodedName = encodeURIComponent(gameName);
  const encodedTag = encodeURIComponent(tagLine);

  const account = await riotFetch(
    `https://${region.regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`
  );

  return { ...account, region };
}

/**
 * Full League of Legends profile: summoner info + ranked stats for all
 * queues the player has an entry in (solo/duo, flex, etc.).
 *
 * NOTE: Riot's summoner-v4 "by-puuid" endpoint no longer returns an
 * encrypted summonerId, so ranked entries are looked up directly by PUUID
 * via league-v4's newer by-puuid endpoint instead of the old by-summoner one.
 */
async function getLeagueProfile(gameName, tagLine, regionKey) {
  const account = await getAccountByRiotId(gameName, tagLine, regionKey);
  const { platform } = account.region;

  const summoner = await riotFetch(
    `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`
  );

  const rankedEntries = await riotFetch(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}`
  );

  return {
    riotId: `${account.gameName}#${account.tagLine}`,
    regionLabel: account.region.label,
    puuid: account.puuid,
    regionalRoute: account.region.regional,
    platform: account.region.platform,
    summonerLevel: summoner.summonerLevel,
    profileIconId: summoner.profileIconId,
    rankedEntries, // array - could be empty if unranked in all queues
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pulls the player's last N ranked solo/duo matches and computes:
 *   - their most frequently played lane
 *   - their top 3 most-played champions in that sample, with in-sample win rate
 *   - aggregate performance metrics: KDA, vision score/min, gold/min,
 *     CS/min, kill participation %, and team damage share %
 *
 * Metrics are computed as sample-wide totals (e.g. total kills / total
 * deaths) rather than an average of each game's individual ratio - this
 * avoids issues like divide-by-zero on a single no-death game and weights
 * longer games proportionally, which is the more standard approach.
 *
 * This makes MATCH_ANALYSIS_COUNT + 1 API calls (1 for the ID list, then one
 * per match), spaced out slightly to stay comfortably under Riot's
 * per-second rate limit on personal/dev keys.
 */
async function analyzeRecentRankedSolo(puuid, regionalRoute) {
  const matchIds = await riotFetch(
    `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${RANKED_SOLO_QUEUE_ID}&start=0&count=${MATCH_ANALYSIS_COUNT}`
  );

  const games = [];
  for (const matchId of matchIds) {
    const match = await riotFetch(
      `https://${regionalRoute}.api.riotgames.com/lol/match/v5/matches/${matchId}`
    );
    const participant = match.info.participants.find((p) => p.puuid === puuid);

    if (participant) {
      const teammates = match.info.participants.filter((p) => p.teamId === participant.teamId);
      const teamKills = teammates.reduce((sum, p) => sum + p.kills, 0);
      const teamDamage = teammates.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);
      const gameMinutes = match.info.gameDuration / 60;

      games.push({
        championName: participant.championName,
        win: participant.win,
        lane: participant.teamPosition,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        goldEarned: participant.goldEarned,
        cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
        visionScore: participant.visionScore,
        damageToChampions: participant.totalDamageDealtToChampions,
        gameMinutes,
        teamKills,
        teamDamage,
      });
    }

    await delay(60); // small gap between requests to avoid bursting the rate limit
  }

  if (games.length === 0) {
    return {
      gamesAnalyzed: 0,
      topLane: null,
      topChampions: [],
      metrics: null,
    };
  }

  // Most frequent lane
  const laneCounts = {};
  for (const game of games) {
    if (!game.lane) continue;
    laneCounts[game.lane] = (laneCounts[game.lane] || 0) + 1;
  }
  const topLaneKey = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Champion frequency + in-sample win rate
  const championStats = {};
  for (const game of games) {
    if (!championStats[game.championName]) {
      championStats[game.championName] = { games: 0, wins: 0 };
    }
    championStats[game.championName].games += 1;
    if (game.win) championStats[game.championName].wins += 1;
  }

  const topChampions = Object.entries(championStats)
    .map(([name, stats]) => ({
      name,
      games: stats.games,
      wins: stats.wins,
      losses: stats.games - stats.wins,
      winRate: Math.round((stats.wins / stats.games) * 100),
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);

  // Aggregate performance metrics across the whole sample
  const totals = games.reduce(
    (acc, g) => ({
      kills: acc.kills + g.kills,
      deaths: acc.deaths + g.deaths,
      assists: acc.assists + g.assists,
      goldEarned: acc.goldEarned + g.goldEarned,
      cs: acc.cs + g.cs,
      visionScore: acc.visionScore + g.visionScore,
      damageToChampions: acc.damageToChampions + g.damageToChampions,
      gameMinutes: acc.gameMinutes + g.gameMinutes,
      teamKills: acc.teamKills + g.teamKills,
      teamDamage: acc.teamDamage + g.teamDamage,
    }),
    { kills: 0, deaths: 0, assists: 0, goldEarned: 0, cs: 0, visionScore: 0, damageToChampions: 0, gameMinutes: 0, teamKills: 0, teamDamage: 0 }
  );

  const metrics = {
    kda: totals.deaths > 0
      ? Number(((totals.kills + totals.assists) / totals.deaths).toFixed(2))
      : null, // null signals "Perfect" (no deaths across the sample)
    visionScorePerMin: Number((totals.visionScore / totals.gameMinutes).toFixed(2)),
    goldPerMin: Math.round(totals.goldEarned / totals.gameMinutes),
    csPerMin: Number((totals.cs / totals.gameMinutes).toFixed(1)),
    killParticipationPct: totals.teamKills > 0
      ? Math.round(((totals.kills + totals.assists) / totals.teamKills) * 100)
      : 0,
    teamDamageSharePct: totals.teamDamage > 0
      ? Math.round((totals.damageToChampions / totals.teamDamage) * 100)
      : 0,
  };

  return {
    gamesAnalyzed: games.length,
    topLane: topLaneKey ? (LANE_LABELS[topLaneKey] || topLaneKey) : null,
    topChampions,
    metrics,
  };
}

/**
 * Top N champions by mastery points (Riot's own persistent mastery ranking,
 * independent of any recent-match sample). Returns raw championId values -
 * pair this with ddragon.getChampionName() to resolve display names.
 */
async function getTopChampionMastery(puuid, platform, count = 3) {
  return riotFetch(
    `https://${platform}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`
  );
}

module.exports = {
  RiotApiError,
  REGION_MAP,
  getAccountByRiotId,
  getLeagueProfile,
  analyzeRecentRankedSolo,
  getTopChampionMastery,
};
