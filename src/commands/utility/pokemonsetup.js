const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { setPokemonChannel, getPokemonChannel } = require('../../services/db');
const { postPokemonRound } = require('../../services/pokemonGameJob');

const TEST_BUTTON_ID = 'pokemontest';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pokemon-setup')
    .setDescription('Set which channel gets the daily "Who\'s That Pokemon?" game (posts 9 AM Central).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post the daily Pokemon round in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'This only works inside a server.', ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel('channel');
    setPokemonChannel(interaction.guild.id, channel.id);

    const testButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(TEST_BUTTON_ID)
        .setLabel('🧪 Test Now')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `Done! I'll post a "Who's That Pokemon?" round in ${channel} every day at 9 AM Central.\n\nWant to see it in action right now instead of waiting? Click below.`,
      components: [testButton],
      ephemeral: true,
    });
  },

  // --- Tester button ---
  // Wired into client.componentHandlers automatically by index.js since this
  // module exports componentId + handleComponent.
  componentId: TEST_BUTTON_ID,
  async handleComponent(interaction) {
    if (!interaction.inGuild()) return;

    const channelId = getPokemonChannel(interaction.guild.id);
    if (!channelId) {
      await interaction.reply({
        content: 'No Pokemon channel is set up yet - run `/pokemon-setup` first.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await postPokemonRound(interaction.client, interaction.guild.id, channelId);
      await interaction.editReply('Test round posted! Go check the channel.');
    } catch (error) {
      console.error('Error posting test Pokemon round:', error);
      await interaction.editReply("Something went wrong posting the test round - check the bot's logs.");
    }
  },
};
