// Registers all slash commands with Discord.
// Run with: npm run deploy
//
// If DEV_GUILD_ID is set in .env, commands are registered to that one server
// only, which updates INSTANTLY - great for development.
// If it's not set, commands are registered globally, which can take up to
// an hour to propagate. Use guild deploys while building, global once you're
// ready to launch bot-wide.

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

for (const category of categories) {
  const categoryPath = path.join(commandsPath, category);
  const commandFiles = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(categoryPath, file));
    if ('data' in command) {
      commands.push(command.data.toJSON());
    }
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} application (/) commands...`);

    const route = process.env.DEV_GUILD_ID
      ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DEV_GUILD_ID)
      : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);

    const data = await rest.put(route, { body: commands });

    console.log(`Successfully deployed ${data.length} command(s)${process.env.DEV_GUILD_ID ? ' to the dev guild' : ' globally'}.`);
  } catch (error) {
    console.error(error);
  }
})();
