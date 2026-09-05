// Wrapper around valorant-api.com - a free, public, no-key-needed reference
// data API for static Valorant game data. Used here just to map agent names
// to their role (Duelist/Controller/Sentinel/Initiator), since HenrikDev's
// API doesn't include role data anywhere. Confirmed working via testing,
// including newer agents (Clove, Waylay).

let cachedAgentRoleMap = null; // Map<agentName, roleName>

async function getAgentRoleMap() {
  if (cachedAgentRoleMap) return cachedAgentRoleMap;

  const response = await fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true');
  if (!response.ok) {
    throw new Error(`valorant-api.com request failed: ${response.status}`);
  }
  const body = await response.json();

  cachedAgentRoleMap = new Map();
  for (const agent of body.data) {
    cachedAgentRoleMap.set(agent.displayName, agent.role?.displayName || 'Unknown');
  }
  return cachedAgentRoleMap;
}

module.exports = { getAgentRoleMap };
