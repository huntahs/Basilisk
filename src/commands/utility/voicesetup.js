const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { addVoiceHub } = require('../../services/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voice-setup')
    .setDescription('Set up a "Join to Create" voice channel hub.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((option) =>
      option
        .setName('existing-channel')
        .setDescription('Use an existing voice channel as the hub instead of creating a new one')
        .addChannelTypes(ChannelType.GuildVoice)
    )
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Name for a newly created hub channel (default: "➕ Create a Voice Channel")')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'This only works inside a server.', ephemeral: true });
      return;
    }

    const existingChannel = interaction.options.getChannel('existing-channel');
    const name = interaction.options.getString('name') || '➕ Create a Voice Channel';

    await interaction.deferReply({ ephemeral: true });

    let hubChannel = existingChannel;
    if (!hubChannel) {
      try {
        hubChannel = await interaction.guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: interaction.channel?.parentId || null,
        });
      } catch (error) {
        console.error('Error creating voice hub channel:', error);
        await interaction.editReply(
          "Couldn't create the channel - make sure Basilisk's role has the **Manage Channels** permission."
        );
        return;
      }
    }

    addVoiceHub(interaction.guild.id, hubChannel.id);

    await interaction.editReply(
      `Done! **${hubChannel.name}** is now a "Join to Create" hub - anyone who joins it gets their own temporary voice channel, and it's deleted automatically once everyone leaves.`
    );
  },
};
