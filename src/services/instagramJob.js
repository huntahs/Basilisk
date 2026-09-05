const cron = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');
const { baseEmbed } = require('./embeds');
const { getRecentMedia, refreshAccessToken } = require('./instagram');
const {
  getAllInstagramConfigs,
  updateInstagramLastSeenMediaId,
  updateInstagramToken,
  setTemporaryBotStatus,
  getTemporaryBotStatus,
  clearTemporaryBotStatus,
} = require('./db');

// Refresh well before the real 60-day expiry, so there's a comfortable
// safety margin even if a scheduled run gets missed once or twice.
const REFRESH_THRESHOLD_MS = 45 * 24 * 60 * 60 * 1000; // 45 days
const STATUS_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Builds the embed + link button used for both real announcements and the
 * /instagram-test preview command, so they always look identical.
 */
function buildAnnouncementEmbedAndRow(media) {
  const embed = baseEmbed({
    title: '📸 New post from UAB Esports on Instagram!',
    description: media.caption ? media.caption.slice(0, 4000) : '(no caption)',
    footer: 'Instagram',
  });

  embed.setURL(media.permalink); // makes the embed title a clickable link to the post

  // Photos/carousels: media_url is a real image, use it directly.
  // Videos/Reels: media_url points to the actual video FILE, which embeds
  // can't render as an image - use thumbnail_url (a static preview image)
  // instead, if present.
  if (media.media_type === 'VIDEO' && media.thumbnail_url) {
    embed.setImage(media.thumbnail_url);
  } else if (media.media_url && (media.media_type === 'IMAGE' || media.media_type === 'CAROUSEL_ALBUM')) {
    embed.setImage(media.media_url);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🔗 View Post on Instagram ↗')
      .setStyle(ButtonStyle.Link)
      .setURL(media.permalink)
  );

  return { embed, row };
}

/**
 * Sets a temporary "New Post!" bot status for 24 hours, persisting the
 * expiry so it survives a restart mid-window. Discord bots can't use a
 * fully custom no-verb status (that's a personal-account-only feature) -
 * this uses the "Watching" activity type, so it displays as
 * "Watching New Post on Our Instagram! :D".
 */
function setNewPostStatus(client) {
  client.user.setActivity('New Post on Our Instagram! :D', { type: ActivityType.Watching });
  setTemporaryBotStatus(Date.now() + STATUS_DURATION_MS);
}

function clearNewPostStatusIfExpired(client) {
  const status = getTemporaryBotStatus();
  if (!status) return;

  if (Date.now() >= status.expiresAt) {
    client.user.setActivity(null);
    clearTemporaryBotStatus();
  }
}

/**
 * Checks one guild's configured Instagram account for a new post. On the
 * very first check (lastSeenMediaId is null), this silently records the
 * current newest post as the baseline WITHOUT announcing it - otherwise
 * setting this up for the first time would immediately blast out an
 * announcement for a post that's potentially already old news.
 */
async function checkForNewPost(client, config) {
  const media = await getRecentMedia(config.accessToken, 1);
  const newest = media[0];
  if (!newest) return;

  if (config.lastSeenMediaId === null) {
    updateInstagramLastSeenMediaId(config.guildId, newest.id);
    return;
  }

  if (newest.id === config.lastSeenMediaId) return; // no new post

  const channel = await client.channels.fetch(config.channelId);
  if (!channel) {
    console.error(`Instagram announcement channel ${config.channelId} not found (guild ${config.guildId})`);
    return;
  }

  const { embed, row } = buildAnnouncementEmbedAndRow(newest);
  await channel.send({ content: '@everyone', embeds: [embed], components: [row] });

  setNewPostStatus(client);
  updateInstagramLastSeenMediaId(config.guildId, newest.id);
}

async function checkAllGuildsForNewPosts(client) {
  const configs = getAllInstagramConfigs();
  for (const config of configs) {
    try {
      await checkForNewPost(client, config);
    } catch (error) {
      console.error(`Error checking Instagram for guild ${config.guildId}:`, error);
    }
  }
  clearNewPostStatusIfExpired(client);
}

async function refreshTokensIfDue() {
  const configs = getAllInstagramConfigs();
  for (const config of configs) {
    const age = Date.now() - config.tokenRefreshedAt;
    if (age < REFRESH_THRESHOLD_MS) continue;

    try {
      const { accessToken } = await refreshAccessToken(config.accessToken);
      updateInstagramToken(config.guildId, accessToken);
      console.log(`Refreshed Instagram token for guild ${config.guildId}`);
    } catch (error) {
      console.error(`Error refreshing Instagram token for guild ${config.guildId}:`, error);
      // Deliberately don't throw - if this fails, we'll just try again on
      // the next scheduled run. The 45-day threshold gives plenty of margin
      // before the token actually expires at 60 days.
    }
  }
}

function initInstagramJob(client) {
  // Resume/resolve any in-progress temporary status immediately on startup,
  // in case the bot restarted partway through a 24-hour window.
  const status = getTemporaryBotStatus();
  if (status) {
    if (Date.now() >= status.expiresAt) {
      client.user.setActivity(null);
      clearTemporaryBotStatus();
    } else {
      client.user.setActivity('New Post on Our Instagram! :D', { type: ActivityType.Watching });
    }
  }

  // Check for new posts every 30 minutes (this also checks/reverts the
  // temporary status once it expires, piggybacking on the same interval).
  cron.schedule('*/30 * * * *', () => {
    checkAllGuildsForNewPosts(client);
  });

  // Check whether any token needs refreshing once a day.
  cron.schedule('0 4 * * *', () => {
    refreshTokensIfDue();
  });

  console.log('Instagram post-check (every 30 min) and token-refresh (daily) jobs scheduled.');
}

module.exports = {
  initInstagramJob,
  checkAllGuildsForNewPosts,
  refreshTokensIfDue,
  buildAnnouncementEmbedAndRow,
};
