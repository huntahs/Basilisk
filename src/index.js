require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // needed for temp voice channels later
    GatewayIntentBits.GuildMembers,     // useful for leaderboards / role-based features
  ],
  partials: [Partials.Channel],
});

// ---- Command loading ----
// Every file in src/commands/<category>/*.js must export { data, execute }.
// Drop a new file in there and it's automatically picked up - no other
// code needs to change to add a new slash command.
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

for (const category of categories) {
  const categoryPath = path.join(commandsPath, category);
  const commandFiles = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(categoryPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`[WARNING] Command at ${filePath} is missing "data" or "execute".`);
    }
  }
}

// ---- Event loading ----
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

client.login(process.env.DISCORD_TOKEN);

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});
