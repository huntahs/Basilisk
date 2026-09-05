// Wrapper around the "Rocket League" RapidAPI (rocket-league10) stats
// endpoint. Confirmed working shape (as of testing): returns lifetime
// career totals (goals/assists/saves/etc.) and current + peak rank per
// playlist. There is NO per-match or recent-games history available from
// this API - only lifetime totals - so anything asking for "last N games"
// data can't be answered from this source.

const RAPIDAPI_HOST = 'rocket-league10.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

// Confirmed from a real response - these are the playlistId values for the
// 3 competitive queue sizes.
const PLAYLIST_IDS = {
  DUEL_1V1: 10,
  DOUBLES_2V2: 11,
  STANDARD_3V3: 13,
};

class RocketLeagueApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'RocketLeagueApiError';
    this.status = status;
  }
}

async function getPlayerStats(platform, username) {
  if (!RAPIDAPI_KEY) {
    throw new RocketLeagueApiError('RAPIDAPI_KEY is not set in the environment.', 0);
  }

  const url = `https://${RAPIDAPI_HOST}/stats/${platform}/${encodeURIComponent(username)}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': RAPIDAPI_KEY,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new RocketLeagueApiError('Player not found - check the platform and username.', 404);
    }
    throw new RocketLeagueApiError(`Rocket League API error ${response.status}`, response.status);
  }

  return response.json();
}

function findPlaylist(data, playlistId) {
  return (
    data.ranked?.find((p) => p.playlistId === playlistId) ||
    data.additional?.find((p) => p.playlistId === playlistId) ||
    null
  );
}

module.exports = { getPlayerStats, findPlaylist, RocketLeagueApiError, PLAYLIST_IDS };
