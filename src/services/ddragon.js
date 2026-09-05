// Wrapper around Riot's public "Data Dragon" static data CDN.
// No API key needed - this is just static game data (champion names,
// profile icon images) that Riot publishes for anyone to use.

let cachedVersion = null;
let cachedChampionMap = null; // Map<championId (number), championName (string)>

async function getLatestVersion() {
  if (cachedVersion) return cachedVersion;

  const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  if (!response.ok) {
    throw new Error(`Data Dragon versions request failed: ${response.status}`);
  }
  const versions = await response.json();
  cachedVersion = versions[0];
  return cachedVersion;
}

async function getChampionNameMap() {
  if (cachedChampionMap) return cachedChampionMap;

  const version = await getLatestVersion();
  const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`);
  if (!response.ok) {
    throw new Error(`Data Dragon champion data request failed: ${response.status}`);
  }
  const data = await response.json();

  cachedChampionMap = new Map();
  for (const champ of Object.values(data.data)) {
    cachedChampionMap.set(Number(champ.key), champ.name);
  }
  return cachedChampionMap;
}

async function getChampionName(championId) {
  const map = await getChampionNameMap();
  return map.get(championId) || `Champion ${championId}`;
}

async function getProfileIconUrl(profileIconId) {
  const version = await getLatestVersion();
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${profileIconId}.png`;
}

module.exports = {
  getLatestVersion,
  getChampionNameMap,
  getChampionName,
  getProfileIconUrl,
};
