// Wrapper around the OverFast API (https://overfast-api.tekrop.fr) - a
// public, free, no-key-needed REST API that scrapes Blizzard's own public
// Overwatch player profile pages. Confirmed working via live testing.
//
// NOTE: unlike our League/Valorant match-history analysis, this API only
// exposes lifetime/season-aggregate stats (general/roles/heroes) - there's
// no per-match or "last N games" data available, similar to the Rocket
// League integration. Be upfront about that in the UI.

const BASE_URL = 'https://overfast-api.tekrop.fr';
const ROLE_KEYS = ['tank', 'damage', 'support'];

class OverfastApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'OverfastApiError';
    this.status = status;
  }
}

async function overfastFetch(url) {
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new OverfastApiError('Player not found - check the BattleTag (format: Name-1234).', 404);
    }
    if (response.status === 429) {
      throw new OverfastApiError('Rate limited by OverFast API - try again in a moment.', 429);
    }
    let detail = '';
    try {
      const body = await response.json();
      detail = body.error || JSON.stringify(body);
    } catch {
      // ignore
    }
    throw new OverfastApiError(`OverFast API error ${response.status}: ${detail}`, response.status);
  }

  return response.json();
}

/**
 * `playerId` is a BattleTag with # replaced by - (e.g. "Name-1234"),
 * matching this API's own identifier convention.
 */
async function getPlayerSummary(playerId) {
  return overfastFetch(`${BASE_URL}/players/${encodeURIComponent(playerId)}/summary`);
}

async function getPlayerStatsSummary(playerId, { gamemode = 'competitive', platform } = {}) {
  let url = `${BASE_URL}/players/${encodeURIComponent(playerId)}/stats/summary?gamemode=${gamemode}`;
  if (platform) url += `&platform=${platform}`;
  return overfastFetch(url);
}

// Cached hero -> role map, sourced from OverFast's own /heroes endpoint
// (no separate third-party API needed for this).
let cachedHeroRoleMap = null;

async function getHeroRoleMap() {
  if (cachedHeroRoleMap) return cachedHeroRoleMap;

  const heroes = await overfastFetch(`${BASE_URL}/heroes`);
  cachedHeroRoleMap = new Map();
  for (const hero of heroes) {
    cachedHeroRoleMap.set(hero.key, hero.role); // role is already 'tank'/'damage'/'support'
  }
  return cachedHeroRoleMap;
}

/**
 * Given both platforms' stats/summary responses, picks whichever platform
 * the player has more competitive games played on. Falls back to 'pc' if
 * both are equal or both empty (e.g. brand new/private profile).
 */
function pickDominantPlatform(pcStats, consoleStats) {
  const pcGames = pcStats?.general?.games_played || 0;
  const consoleGames = consoleStats?.general?.games_played || 0;
  return consoleGames > pcGames ? 'console' : 'pc';
}

/**
 * Groups the heroes stats dict by role (using the hero role map), sorted by
 * games played, up to `perRoleCount` heroes per role. Heroes with 0 games
 * are excluded.
 */
function groupHeroesByRole(heroesStats, heroRoleMap, perRoleCount = 2) {
  const grouped = { tank: [], damage: [], support: [] };
  if (!heroesStats) return grouped;

  for (const [heroKey, stats] of Object.entries(heroesStats)) {
    if (!stats || stats.games_played <= 0) continue;
    const role = heroRoleMap.get(heroKey);
    if (!role || !grouped[role]) continue;

    grouped[role].push({
      name: heroKey,
      gamesPlayed: stats.games_played,
      winRate: Math.round(stats.winrate),
      timePlayed: stats.time_played, // seconds
    });
  }

  for (const role of ROLE_KEYS) {
    grouped[role].sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    grouped[role] = grouped[role].slice(0, perRoleCount);
  }

  return grouped;
}

/**
 * Compares games_played across tank/damage/support (from stats.roles) and
 * returns whichever role has the most games, or null if no role data exists.
 */
function findMostPlayedRole(rolesStats) {
  if (!rolesStats) return null;
  let best = null;
  let bestGames = -1;
  for (const role of ROLE_KEYS) {
    const games = rolesStats[role]?.games_played || 0;
    if (games > bestGames) {
      bestGames = games;
      best = role;
    }
  }
  return bestGames > 0 ? best : null;
}

function formatPlaytime(seconds) {
  if (!seconds || seconds <= 0) return '0h 0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

module.exports = {
  OverfastApiError,
  getPlayerSummary,
  getPlayerStatsSummary,
  getHeroRoleMap,
  pickDominantPlatform,
  groupHeroesByRole,
  findMostPlayedRole,
  formatPlaytime,
  ROLE_KEYS,
};
