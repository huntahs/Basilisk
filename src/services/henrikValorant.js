// Wrapper around HenrikDev's unofficial Valorant API (api.henrikdev.xyz).
// Confirmed working via testing:
//   - account/MMR/match-history endpoints all functional with a Basic key
//   - match objects include match.teams.{red,blue}.has_won for win/loss
//   - match.kills[] includes damage_weapon_name per kill (killer-attributed
//     only - deaths/assists are NOT weapon-attributable in this data)
//   - agent ROLE is not included here at all - see valorantContent.js

const HENRIK_API_KEY = process.env.HENRIK_API_KEY;
const HENRIK_BASE = 'https://api.henrikdev.xyz/valorant';

const COMPETITIVE_MATCH_COUNT = 20;

class HenrikApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HenrikApiError';
    this.status = status;
  }
}

async function henrikFetch(url) {
  if (!HENRIK_API_KEY) {
    throw new HenrikApiError('HENRIK_API_KEY is not set in the environment.', 0);
  }

  const response = await fetch(url, {
    headers: { Authorization: HENRIK_API_KEY },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new HenrikApiError('Player not found.', 404);
    }
    if (response.status === 429) {
      throw new HenrikApiError('Rate limited by HenrikDev API - try again in a moment.', 429);
    }
    let detail = '';
    try {
      const body = await response.json();
      detail = JSON.stringify(body.errors || body);
    } catch {
      // ignore
    }
    throw new HenrikApiError(`HenrikDev API error ${response.status}: ${detail}`, response.status);
  }

  const body = await response.json();
  return body.data;
}

async function getAccount(name, tag) {
  return henrikFetch(`${HENRIK_BASE}/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
}

async function getMMR(region, name, tag) {
  return henrikFetch(`${HENRIK_BASE}/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
}

/**
 * Gets recent COMPETITIVE matches only (filter=competitive), up to
 * COMPETITIVE_MATCH_COUNT of them, in a single API call.
 */
async function getRecentCompetitiveMatches(region, name, tag, size = COMPETITIVE_MATCH_COUNT) {
  return henrikFetch(
    `${HENRIK_BASE}/v3/matches/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?filter=competitive&size=${size}`
  );
}

/**
 * Analyzes a batch of competitive match objects (as returned by
 * getRecentCompetitiveMatches) for one specific player, computing:
 *   - overall win/loss record + K/D across the sample
 *   - top 3 agents by frequency, each with win/loss record
 *   - top 2 roles by frequency % (requires an agentName -> role map, see
 *     valorantContent.js - passed in rather than fetched here to keep this
 *     function focused on match data only)
 *   - top 3 weapons by kill count
 *   - per-map stats: win rate + top 2 agents played on that map
 */
function analyzeCompetitiveMatches(matches, myPuuid, agentRoleMap) {
  const games = [];

  for (const match of matches) {
    const me = match.players?.all_players?.find((p) => p.puuid === myPuuid);
    if (!me) continue;

    const teamKey = me.team.toLowerCase(); // 'blue' or 'red'
    const won = !!match.teams?.[teamKey]?.has_won;

    const myKillsByWeapon = {};
    for (const kill of match.kills || []) {
      if (kill.killer_puuid !== myPuuid) continue;
      const weapon = kill.damage_weapon_name || 'Unknown';
      myKillsByWeapon[weapon] = (myKillsByWeapon[weapon] || 0) + 1;
    }

    games.push({
      agent: me.character,
      map: match.metadata?.map || 'Unknown',
      won,
      kills: me.stats?.kills ?? 0,
      deaths: me.stats?.deaths ?? 0,
      assists: me.stats?.assists ?? 0,
      killsByWeapon: myKillsByWeapon,
    });
  }

  if (games.length === 0) {
    return { gamesAnalyzed: 0 };
  }

  const wins = games.filter((g) => g.won).length;
  const losses = games.length - wins;
  const totalKills = games.reduce((sum, g) => sum + g.kills, 0);
  const totalDeaths = games.reduce((sum, g) => sum + g.deaths, 0);
  const totalAssists = games.reduce((sum, g) => sum + g.assists, 0);
  const kdRatio = totalDeaths > 0 ? Number((totalKills / totalDeaths).toFixed(2)) : null; // null = "Perfect"

  // --- Top agents ---
  const agentStats = {};
  for (const g of games) {
    if (!agentStats[g.agent]) agentStats[g.agent] = { games: 0, wins: 0 };
    agentStats[g.agent].games += 1;
    if (g.won) agentStats[g.agent].wins += 1;
  }
  const topAgents = Object.entries(agentStats)
    .map(([name, s]) => ({
      name,
      games: s.games,
      wins: s.wins,
      losses: s.games - s.wins,
      winRate: Math.round((s.wins / s.games) * 100),
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);

  // --- Top roles (derived from agent -> role map) ---
  const roleCounts = {};
  for (const g of games) {
    const role = agentRoleMap?.get(g.agent) || 'Unknown';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  const topRoles = Object.entries(roleCounts)
    .map(([role, count]) => ({ role, pct: Math.round((count / games.length) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 2);

  // --- Top weapons by kill count ---
  const weaponKillCounts = {};
  for (const g of games) {
    for (const [weapon, count] of Object.entries(g.killsByWeapon)) {
      weaponKillCounts[weapon] = (weaponKillCounts[weapon] || 0) + count;
    }
  }
  const topWeapons = Object.entries(weaponKillCounts)
    .map(([name, kills]) => ({ name, kills }))
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 3);

  // --- Per-map stats: win rate + top 2 agents on that map ---
  const mapGroups = {};
  for (const g of games) {
    if (!mapGroups[g.map]) mapGroups[g.map] = [];
    mapGroups[g.map].push(g);
  }
  const mapStats = Object.entries(mapGroups)
    .map(([map, mapGames]) => {
      const mapWins = mapGames.filter((g) => g.won).length;
      const mapAgentCounts = {};
      for (const g of mapGames) {
        mapAgentCounts[g.agent] = (mapAgentCounts[g.agent] || 0) + 1;
      }
      const topMapAgents = Object.entries(mapAgentCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name]) => name);

      return {
        map,
        games: mapGames.length,
        wins: mapWins,
        losses: mapGames.length - mapWins,
        winRate: Math.round((mapWins / mapGames.length) * 100),
        topAgents: topMapAgents,
      };
    })
    .sort((a, b) => b.games - a.games);

  return {
    gamesAnalyzed: games.length,
    wins,
    losses,
    winRatePct: Math.round((wins / games.length) * 100),
    kdRatio,
    totalKills,
    totalDeaths,
    totalAssists,
    topAgents,
    topRoles,
    topWeapons,
    mapStats,
  };
}

module.exports = {
  HenrikApiError,
  getAccount,
  getMMR,
  getRecentCompetitiveMatches,
  analyzeCompetitiveMatches,
};
