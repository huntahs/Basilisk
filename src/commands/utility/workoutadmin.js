const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { removeWorkoutRecordByMessageId, setWorkoutChannel } = require('../../services/db');

function hasPermission(interaction, permission) {
  return interaction.member?.permissions?.has(permission);
}

async function handleNix(interaction) {
  // nix specifically needs Manage Messages - the command-level restriction
  // below (Manage Channels) is just what determines whether people even SEE
  // this command at all; this check enforces the exact permission this
  // particular subcommand actually needs.
  if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: 'You need the Manage Messages permission to use this.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const messageId = interaction.options.getString('message-id');
  const removed = removeWorkoutRecordByMessageId(messageId);

  await interaction.reply({
    content: removed
      ? `Removed the submission for message ID \`${messageId}\` from the leaderboard.`
      : `No tracked submission found with message ID \`${messageId}\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetup(interaction) {
  if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({
      content: 'You need the Manage Channels permission to use this.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel');
  setWorkoutChannel(interaction.guild.id, channel.id);

  await interaction.reply({
    content: `Done! The 9 PM Central workout progress check will post in ${channel}.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('workout-admin')
    .setDescription('Admin tools for the workout leaderboard.')
    // Command-level gate - hides this whole command from anyone without
    // Manage Channels, so regular members never see nix/setup as options
    // at all (unlike before, when they were subcommands of the public
    // /workout and only got rejected after trying to run them).
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('nix')
        .setDescription('[Manage Messages] Remove a submission from the leaderboard by message ID.')
        .addStringOption((o) => o.setName('message-id').setDescription('Message ID of the submission to remove').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('[Manage Channels] Set the channel for the 9 PM daily progress check.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for the progress check').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'This only works inside a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'nix':
        await handleNix(interaction);
        break;
      case 'setup':
        await handleSetup(interaction);
        break;
    }
  },
};
