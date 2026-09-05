// Wrapper around start.gg's GraphQL API (https://api.start.gg/gql/alpha).
// Confirmed working via extensive live testing:
//   - No direct "search by gamertag" query exists - players are looked up
//     via their start.gg profile slug (an opaque ID from their profile URL,
//     e.g. "d3106f2f"), not their gamerTag. Real UX limitation, unique to
//     this integration.
//   - start.gg enforces a hard query complexity cap: max 1000 "objects" per
//     request. Confirmed safe ceilings via testing:
//       - LIGHT query (no nested games/selections): perPage up to 100
//       - HEAVY query (with games/selections/stage): perPage up to 30
//     Going above these throws a complexity error, not a silent truncation.
//   - Sets come back newest-first, confirmed via testing (page N has older
//     completedAt values than page N-1) - this lets us stop paginating
//     early once we've paged past a date cutoff, rather than always
//     fetching a player's entire history.
//   - DQ'd sets have displayScore exactly equal to "DQ" - confirmed via
//     real data, a clean exact-match signal (not just a substring guess).
//   - Character selection data is populated for most (not all) sets,
//     depending on whether the tournament organizer's software reported it.
//   - Stage/map data has come back null in every test so far - included
//     here defensively, but expect it to often be empty.
//   - Player.rankings is often null (only top regional competitors qualify)
//     - treated as optional bonus data, not core.

const STARTGG_API_TOKEN = process.env.STARTGG_API_KEY;
const STARTGG_URL = 'https://api.start.gg/gql/alpha';
const SMASH_ULTIMATE_ID = 1386; // confirmed via live query, not guessed

const LIGHT_PER_PAGE = 100; // confirmed safe ceiling for the no-games query
const LIGHT_MAX_PAGES = 15; // 15 x 100 = 1500 sets max - safety cap for all-time history
const HEAVY_PER_PAGE = 30; // confirmed safe ceiling for the with-games query
const HEAVY_MAX_PAGES = 15; // 15 x 30 = 450 sets max - safety cap for the last-year window

const SIX_MONTHS_SECONDS = 6 * 30 * 24 * 60 * 60;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

class StartggApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'StartggApiError';
    this.status = status;
  }
}

async function gqlRequest(query, variables = {}) {
  if (!STARTGG_API_TOKEN) {
    throw new StartggApiError('STARTGG_API_KEY is not set in the environment.', 0);
  }

  const response = await fetch(STARTGG_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${STARTGG_API_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new StartggApiError(`start.gg API error ${response.status}`, response.status);
  }

  const body = await response.json();
  if (body.errors) {
    const message = body.errors.map((e) => e.message).join('; ');
    throw new StartggApiError(`start.gg query error: ${message}`, 400);
  }

  return body.data;
}

function isDQ(set) {
  return (set.displayScore || '').trim().toUpperCase() === 'DQ';
}

/**
 * Finds which slot in a set belongs to the player we're looking up, by
 * matching gamerTag against slot.entrant.name. This is what makes win/loss
 * and character attribution reliable instead of guessed.
 *
 * IMPORTANT: entrant.name isn't always just the bare gamerTag - when a
 * player has a team/sponsor prefix set, start.gg often reports the entrant
 * name as "Prefix | GamerTag" instead (confirmed via real data: a player
 * with prefix "ML" showed up as "ML | KoolK" on recent sets, but as just
 * "KoolK" on older ones). An exact-match-only check silently fails on every
 * prefixed set, so we also accept a "| gamerTag" suffix match.
 */
function findMySlot(set, normalizedGamerTag) {
  return set.slots?.find((slot) => {
    const name = slot.entrant?.name?.toLowerCase();
    if (!name) return false;
    return name === normalizedGamerTag || name.endsWith(`| ${normalizedGamerTag}`);
  });
}

/**
 * Fetches ALL of a player's sets using the LIGHT field shape (no nested
 * games/selections/stage - keeps query complexity low so we can use a much
 * higher perPage). Used for all-time and 6-month win/loss, since neither
 * needs character/stage detail.
 */
async function fetchAllLightSets(userSlug) {
  const allSets = [];
  for (let page = 1; page <= LIGHT_MAX_PAGES; page++) {
    const data = await gqlRequest(
      `query LightSets($slug: String!, $page: Int!, $perPage: Int!) {
        user(slug: $slug) {
          player {
            sets(page: $page, perPage: $perPage) {
              pageInfo { totalPages }
              nodes {
                id
                winnerId
                completedAt
                displayScore
                slots { entrant { id name } }
                event { videogame { id } }
              }
            }
          }
        }
      }`,
      { slug: userSlug, page, perPage: LIGHT_PER_PAGE }
    );

    const connection = data?.user?.player?.sets;
    const nodes = connection?.nodes || [];
    allSets.push(...nodes);

    if (page >= (connection?.pageInfo?.totalPages || 1)) break;
  }

  return allSets.filter((s) => s.event?.videogame?.id === SMASH_ULTIMATE_ID);
}

/**
 * Fetches sets using the HEAVY field shape (with games/selections/stage),
 * stopping early once we've paged past `sinceTimestamp` (sets come back
 * newest-first, confirmed via testing) - so this naturally bounds itself to
 * roughly "the last year" instead of fetching someone's entire history at
 * the more expensive heavy complexity cost.
 */
async function fetchRecentHeavySets(userSlug, sinceTimestamp) {
  const allSets = [];
  for (let page = 1; page <= HEAVY_MAX_PAGES; page++) {
    const data = await gqlRequest(
      `query HeavySets($slug: String!, $page: Int!, $perPage: Int!) {
        user(slug: $slug) {
          player {
            sets(page: $page, perPage: $perPage) {
              pageInfo { totalPages }
              nodes {
                id
                completedAt
                displayScore
                slots { entrant { id name } }
                event { videogame { id } }
                games {
                  winnerId
                  stage { name }
                  selections {
                    entrant { id }
                    character {
                      name
                      images { url type }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { slug: userSlug, page, perPage: HEAVY_PER_PAGE }
    );

    const connection = data?.user?.player?.sets;
    const nodes = connection?.nodes || [];
    allSets.push(...nodes);

    const oldestInPage = nodes[nodes.length - 1]?.completedAt;
    const hitCutoff = oldestInPage && oldestInPage < sinceTimestamp;
    if (hitCutoff || page >= (connection?.pageInfo?.totalPages || 1)) break;
  }

  return allSets.filter((s) => s.event?.videogame?.id === SMASH_ULTIMATE_ID && s.completedAt >= sinceTimestamp);
}

/**
 * Computes win/loss from a batch of LIGHT-shape sets, excluding DQs.
 */
function computeWinLoss(sets, gamerTag) {
  const normalizedTag = gamerTag.toLowerCase();
  let wins = 0;
  let losses = 0;

  for (const set of sets) {
    if (isDQ(set)) continue;
    const mySlot = findMySlot(set, normalizedTag);
    if (!mySlot?.entrant) continue;
    if (set.winnerId === mySlot.entrant.id) wins += 1;
    else losses += 1;
  }

  const total = wins + losses;
  return { wins, losses, total, winRatePct: total > 0 ? Math.round((wins / total) * 100) : null };
}

/**
 * Computes top-N most-played characters (with per-character win/loss, using
 * per-GAME winnerId for accurate attribution) from a batch of HEAVY-shape
 * sets, excluding DQs.
 */
function computeCharacterStats(sets, gamerTag, topN = 3) {
  const normalizedTag = gamerTag.toLowerCase();
  const characterStats = {}; // name -> { games, wins, iconUrl }
  let totalGames = 0;

  for (const set of sets) {
    if (isDQ(set)) continue;
    const mySlot = findMySlot(set, normalizedTag);
    if (!mySlot?.entrant) continue;
    const myEntrantId = mySlot.entrant.id;

    for (const game of set.games || []) {
      const mySelection = game.selections?.find((sel) => sel.entrant?.id === myEntrantId);
      const charName = mySelection?.character?.name;
      // "Random Character" is a placeholder some tournament software reports
      // when it isn't actually tracking character selections - not a real pick.
      if (!charName || charName === 'Random Character') continue;

      if (!characterStats[charName]) {
        const iconImage = mySelection.character.images?.find((img) => img.type === 'icon');
        characterStats[charName] = { games: 0, wins: 0, iconUrl: iconImage?.url || null };
      }
      characterStats[charName].games += 1;
      if (game.winnerId === myEntrantId) characterStats[charName].wins += 1;
      totalGames += 1;
    }
  }

  return Object.entries(characterStats)
    .map(([name, stats]) => ({
      name,
      gamesPlayed: stats.games,
      wins: stats.wins,
      losses: stats.games - stats.wins,
      winRatePct: Math.round((stats.wins / stats.games) * 100),
      playratePct: totalGames > 0 ? Math.round((stats.games / totalGames) * 100) : 0,
      iconUrl: stats.iconUrl,
    }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, topN);
}

/**
 * Computes most-played stages from a batch of HEAVY-shape sets. Returns an
 * empty array if no stage data is present at all - this is common (many
 * tournaments don't report stage picks), so callers should handle an empty
 * result gracefully rather than treating it as an error.
 */
function computeStageStats(sets, topN = 3) {
  const stageCounts = {};
  for (const set of sets) {
    for (const game of set.games || []) {
      const stageName = game.stage?.name;
      if (!stageName) continue;
      stageCounts[stageName] = (stageCounts[stageName] || 0) + 1;
    }
  }

  return Object.entries(stageCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

/**
 * Full player data: identity, rankings, recent standings, all-time and
 * 6-month win/loss, and last-year character/stage stats.
 *
 * `userSlug` is the opaque ID from a person's start.gg profile URL
 * (start.gg/user/{slug}) - there is no way to look someone up by gamerTag
 * directly, this is a real limitation of start.gg's public API.
 */
async function getSmashPlayerData(userSlug) {
  const identityData = await gqlRequest(
    `query PlayerIdentity($slug: String!, $videogameId: ID!) {
      user(slug: $slug) {
        images { url }
        player {
          id
          gamerTag
          prefix
          rankings(videogameId: $videogameId, limit: 1) {
            rank
            title
          }
          recentStandings(videogameId: $videogameId, limit: 5) {
            placement
            entrant {
              event {
                name
                tournament { name }
              }
            }
          }
        }
      }
    }`,
    { slug: userSlug, videogameId: SMASH_ULTIMATE_ID }
  );

  const player = identityData?.user?.player;
  if (!player) {
    throw new StartggApiError('No player found for that profile - check the slug from their start.gg profile URL.', 404);
  }

  const gamerTag = player.gamerTag;
  const now = Math.floor(Date.now() / 1000);

  const lightSets = await fetchAllLightSets(userSlug);
  const allTimeRecord = computeWinLoss(lightSets, gamerTag);
  const sixMonthSets = lightSets.filter((s) => s.completedAt >= now - SIX_MONTHS_SECONDS);
  const sixMonthRecord = computeWinLoss(sixMonthSets, gamerTag);

  const heavySets = await fetchRecentHeavySets(userSlug, now - ONE_YEAR_SECONDS);
  const topCharacters = computeCharacterStats(heavySets, gamerTag, 3);
  const topStages = computeStageStats(heavySets, 3);

  return {
    playerId: player.id,
    gamerTag,
    prefix: player.prefix,
    avatarUrl: identityData?.user?.images?.[0]?.url || null,
    ranking: player.rankings?.[0] || null,
    recentStandings: player.recentStandings || [],
    allTimeRecord,
    sixMonthRecord,
    topCharacters,
    topStages,
    startggProfileUrl: `https://www.start.gg/user/${encodeURIComponent(userSlug)}`,
    // Inferred from a real example URL (supermajor.gg/ultimate/player/Name?id=S{startggPlayerId})
    // - not officially documented, worth verifying it actually resolves.
    supermajorUrl: `https://www.supermajor.gg/ultimate/player/${encodeURIComponent(gamerTag)}?id=S${player.id}`,
  };
}

module.exports = { StartggApiError, getSmashPlayerData, SMASH_ULTIMATE_ID };
