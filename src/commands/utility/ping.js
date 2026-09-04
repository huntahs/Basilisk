const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Checks the bot is alive and reports latency.'),

  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pinging...', withResponse: true });
    const latency = sent.resource.message.createdTimestamp - interaction.createdTimestamp;

    await interaction.editReply(
      `Pong! Roundtrip latency: ${latency}ms. WebSocket: ${interaction.client.ws.ping}ms.`
    );
  },
};
