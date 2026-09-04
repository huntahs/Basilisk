const { Events, MessageFlags } = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching "${interaction.commandName}" was found.`);
        return;
      }

      try {
        await command.execute(interaction, client);
      } catch (error) {
        console.error(`Error executing "${interaction.commandName}":`, error);

        const errorReply = {
          content: 'Something went wrong running that command. Try again in a bit.',
          flags: MessageFlags.Ephemeral,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply);
        } else {
          await interaction.reply(errorReply);
        }
      }
      return;
    }

    // Button/select-menu interactions (e.g. "create temp voice channel" buttons
    // later on) will come through here too - route them the same way.
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const handler = client.componentHandlers?.get(interaction.customId.split(':')[0]);
      if (handler) {
        try {
          await handler(interaction, client);
        } catch (error) {
          console.error(`Error executing component handler for "${interaction.customId}":`, error);
        }
      }
    }
  },
};
