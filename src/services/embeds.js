const { EmbedBuilder } = require('discord.js');

// UAB colors - green. Swap this hex to match your exact brand green if needed.
const UAB_GREEN = 0x1E6B52;

/**
 * Base embed with consistent UAB Esports branding.
 * Pass overrides like { title, description, fields, thumbnail } and spread
 * game-specific data on top of this.
 */
function baseEmbed({ title, description, footer } = {}) {
  const embed = new EmbedBuilder()
    .setColor(UAB_GREEN)
    .setTimestamp();

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  embed.setFooter({ text: footer || 'Basilisk • UAB Esports' });

  return embed;
}

module.exports = { baseEmbed, UAB_GREEN };
