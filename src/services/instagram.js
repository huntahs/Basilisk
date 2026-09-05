// Wrapper around the Instagram Graph API (graph.instagram.com), using the
// "Instagram API with Instagram Login" path - confirmed working via live
// testing, no linked Facebook Page required.

const GRAPH_BASE = 'https://graph.instagram.com';

class InstagramApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'InstagramApiError';
    this.status = status;
  }
}

async function igFetch(url) {
  const response = await fetch(url);
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body.error?.message || JSON.stringify(body);
    } catch {
      // ignore
    }
    throw new InstagramApiError(`Instagram API error ${response.status}: ${detail}`, response.status);
  }
  return response.json();
}

/**
 * Gets the account's most recent media items (confirmed to return
 * newest-first, matching standard Instagram Graph API convention).
 */
async function getRecentMedia(accessToken, limit = 5) {
  const url = `${GRAPH_BASE}/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=${limit}&access_token=${accessToken}`;
  const body = await igFetch(url);
  return body.data || [];
}

/**
 * Refreshes a long-lived access token for another 60 days. Requirements
 * (per Meta's docs): token must be at least 24 hours old and not expired.
 */
async function refreshAccessToken(accessToken) {
  const url = `${GRAPH_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${accessToken}`;
  const body = await igFetch(url);
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
}

module.exports = { InstagramApiError, getRecentMedia, refreshAccessToken };
