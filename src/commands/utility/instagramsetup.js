const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { setInstagramConfig } = require('../../services/db');
const { getRecentMedia, InstagramApiError } = require('../../services/instagram');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('instagram-setup')
    .setDescription('Set up automatic @everyone announcements when UAB Esports posts on Instagram.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post new-post announcements in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('access-token')
        .setDescription('Long-lived Instagram Graph API access token (kept private - this reply is ephemeral)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'This only works inside a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel('channel');
    const accessToken = interaction.options.getString('access-token');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Verify the token actually works, and grab the current newest post
      // as a baseline so we don't immediately announce old news.
      const media = await getRecentMedia(accessToken, 1);
      const baselineMediaId = media[0]?.id || null;

      setInstagramConfig(interaction.guild.id, {
        channelId: channel.id,
        accessToken,
        lastSeenMediaId: baselineMediaId,
      });

      await interaction.editReply(
        `Done! I'll check for new Instagram posts every 30 minutes and announce them in ${channel} with @everyone. ` +
        `Your token will be refreshed automatically before it expires - no need to run this again unless something breaks.`
      );
    } catch (error) {
      if (error instanceof InstagramApiError) {
        await interaction.editReply(`Couldn't verify that token: ${error.message}`);
        return;
      }
      throw error;
    }
  },
};
