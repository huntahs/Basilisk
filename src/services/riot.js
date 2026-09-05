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
 */
async function getLeagueProfile(gameName, tagLine, regionKey) {
  const account = await getAccountByRiotId(gameName, tagLine, regionKey);
  const { platform } = account.region;

  const summoner = await riotFetch(
    `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`
  );

  const rankedEntries = await riotFetch(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summoner.id}`
  );

  return {
    riotId: `${account.gameName}#${account.tagLine}`,
    regionLabel: account.region.label,
    summonerLevel: summoner.summonerLevel,
    profileIconId: summoner.profileIconId,
    rankedEntries, // array - could be empty if unranked in all queues
  };
}

module.exports = {
  RiotApiError,
  REGION_MAP,
  getAccountByRiotId,
  getLeagueProfile,
};