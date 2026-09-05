const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { baseEmbed } = require('../../services/embeds');
const {
  addWorkoutRecord,
  removeWorkoutRecordByMessageId,
  getWorkoutLeaderboard,
  logWorkout,
  setWorkoutChannel,
} = require('../../services/db');
const { getChicagoDateStr } = require('../../services/dateUtils');

const LIFT_LABELS = { squat: 'Squat', bench: 'Bench Press', deadlift: 'Deadlift' };
const LIFT_CHOICES = [
  { name: 'Squat', value: 'squat' },
  { name: 'Bench Press', value: 'bench' },
  { name: 'Deadlift', value: 'deadlift' },
];
const MEDALS = ['🥇', '🥈', '🥉'];

function hasPermission(interaction, permission) {
  return interaction.member?.permissions?.has(permission);
}

async function handleRecord(interaction) {
  const lift = interaction.options.getString('lift');
  const weight = interaction.options.getNumber('weight');
  const unit = interaction.options.getString('unit') || 'lbs';
  const video = interaction.options.getAttachment('video');

  if (weight <= 0) {
    await interaction.reply({ content: 'Weight has to be a positive number.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply(); // fetching/re-attaching the video can take a moment - avoid Discord's 3s reply timeout

  const liftLabel = LIFT_LABELS[lift];
  const embed = baseEmbed({
    title: `🏋️ New ${liftLabel} Submission`,
    description: `${interaction.user} submitted **${weight} ${unit}** for ${liftLabel}.`,
    footer: 'Workout Leaderboard',
  });

  await interaction.editReply({ embeds: [embed], files: [video.url] });
  const sentMessage = await interaction.fetchReply();

  addWorkoutRecord(interaction.guild.id, {
    messageId: sentMessage.id,
    channelId: sentMessage.channel.id,
    userId: interaction.user.id,
    lift,
    weight,
    unit,
  });
}

async function handleLeaderboard(interaction) {
  const lift = interaction.options.getString('lift');
  const liftLabel = LIFT_LABELS[lift];
  const records = getWorkoutLeaderboard(interaction.guild.id, lift);

  if (records.length === 0) {
    await interaction.reply(`No ${liftLabel} submissions yet - be the first with \`/workout record\`!`);
    return;
  }

  const lines = records.slice(0, 10).map((r, i) => {
    const rank = MEDALS[i] || `#${i + 1}`;
    const jumpUrl = `https://discord.com/channels/${interaction.guild.id}/${r.channelId}/${r.messageId}`;
    return `${rank} <@${r.userId}> — **${r.weight} ${r.unit}** — [View Proof](${jumpUrl})`;
  });

  const embed = baseEmbed({
    title: `🏆 ${liftLabel} Leaderboard`,
    description: lines.join('\n'),
    footer: "Shows each person's personal best",
  });

  await interaction.reply({ embeds: [embed] });
}

async function handleLog(interaction) {
  const dateStr = getChicagoDateStr(new Date());
  const result = logWorkout(interaction.guild.id, interaction.user.id, dateStr);

  if (result.alreadyLoggedToday) {
    await interaction.reply({
      content: `You've already logged a workout today! Current streak: 🔥 ${result.streak} day(s).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply(`✅ Workout logged for today! Current streak: 🔥 ${result.streak} day(s).`);
}

async function handleNix(interaction) {
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
    .setName('workout')
    .setDescription('Workout leaderboards and daily activity tracking.')
    .addSubcommand((sub) =>
      sub
        .setName('record')
        .setDescription('Submit a squat/bench/deadlift PR with video proof.')
        .addStringOption((o) => o.setName('lift').setDescription('Which lift').setRequired(true).addChoices(...LIFT_CHOICES))
        .addNumberOption((o) => o.setName('weight').setDescription('Weight lifted').setRequired(true))
        .addAttachmentOption((o) => o.setName('video').setDescription('Video proof of the lift').setRequired(true))
        .addStringOption((o) =>
          o.setName('unit').setDescription('Unit (defaults to lbs)').addChoices(
            { name: 'lbs', value: 'lbs' },
            { name: 'kg', value: 'kg' }
          )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('leaderboard')
        .setDescription('View the squat/bench/deadlift leaderboard.')
        .addStringOption((o) => o.setName('lift').setDescription('Which lift').setRequired(true).addChoices(...LIFT_CHOICES))
    )
    .addSubcommand((sub) =>
      sub
        .setName('log')
        .setDescription('Log that you worked out today - no proof needed, one log per calendar day.')
    )
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
      case 'record':
        await handleRecord(interaction);
        break;
      case 'leaderboard':
        await handleLeaderboard(interaction);
        break;
      case 'log':
        await handleLog(interaction);
        break;
      case 'nix':
        await handleNix(interaction);
        break;
      case 'setup':
        await handleSetup(interaction);
        break;
    }
  },
};
