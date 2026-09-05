const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getInstagramConfig } = require('../../services/db');
const { getRecentMedia, InstagramApiError } = require('../../services/instagram');
const { buildAnnouncementEmbedAndRow } = require('../../services/instagramJob');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('instagram-test')
    .setDescription('Preview what a new-post announcement looks like, using your actual last post - no @everyone ping.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'This only works inside a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const config = getInstagramConfig(interaction.guild.id);
    if (!config) {
      await interaction.reply({
        content: 'No Instagram integration is set up yet - run `/instagram-setup` first.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const media = await getRecentMedia(config.accessToken, 1);
      const latest = media[0];
      if (!latest) {
        await interaction.editReply("Couldn't find any posts on this account.");
        return;
      }

      const { embed, row } = buildAnnouncementEmbedAndRow(latest);

      await interaction.editReply({
        content: "🧪 **Test preview** - this is what a real announcement will look like (no @everyone was sent):",
        embeds: [embed],
        components: [row],
      });
    } catch (error) {
      if (error instanceof InstagramApiError) {
        await interaction.editReply(`Couldn't load the latest post: ${error.message}`);
        return;
      }
      throw error;
    }
  },
};
