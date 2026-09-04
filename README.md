# Basilisk

Basilisk is the UAB Esports Discord bot: player stat lookups (Tracker
Network), tournament data (start.gg), patch note alerts, and general server
utilities (temp voice channels, workout leaderboards, etc.).

## Project structure

```
src/
  index.js              -> bot entrypoint, loads commands + events automatically
  deploy-commands.js    -> registers slash commands with Discord
  events/               -> discord.js event handlers (ready, interactionCreate, ...)
  commands/
    utility/            -> general commands (ping, temp voice channels later)
    stats/              -> Tracker Network game stat commands
    tournaments/         -> start.gg / SSBU commands
    patchnotes/          -> patch note lookup commands
    admin/               -> mod/admin-only commands
  services/
    embeds.js            -> shared UAB-branded embed builder
    tracker.js            -> (to build) Tracker Network API wrapper
    startgg.js             -> (to build) start.gg GraphQL wrapper
  data/                    -> local SQLite DB for leaderboards / VC configs (git-ignored)
```

Adding a new slash command is just: drop a new file in the right `commands/`
subfolder exporting `{ data, execute }`. `index.js` picks it up automatically —
nothing else needs to change.

## Local setup

1. Create a bot application named **Basilisk** in the
   [Discord Developer Portal](https://discord.com/developers/applications)
   if you haven't already (set its username/avatar there — that's what
   controls the name shown in Discord, separate from this code).
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` / `DISCORD_PUBLIC_KEY` from the
     [Discord Developer Portal](https://discord.com/developers/applications)
   - `DEV_GUILD_ID` — your UAB Esports server ID, for instant command updates
     while developing (Discord Settings > Advanced > Developer Mode, then
     right-click the server icon > Copy Server ID)
   - `TRACKER_API_KEY` from tracker.gg's developer portal
   - `STARTGG_API_KEY` from start.gg's developer settings
4. Register your slash commands (do this again any time you add/rename a command):
   ```
   npm run deploy
   ```
5. Start the bot:
   ```
   npm start
   ```

You should see `Basilisk is online as <BotName>` in the console, and `/ping` should
work in your server within a few seconds (since it's guild-scoped via
`DEV_GUILD_ID`).

## Deploying to Wispbyte

Wispbyte runs apps through a Pterodactyl-style panel:

1. Create a new server/instance and pick the **Node.js** egg.
2. Upload the project (or connect it via Git — see below) so `package.json`
   sits at the server's root.
3. In the startup configuration, make sure:
   - Main/entrypoint file: `src/index.js` (the `npm start` script also points here)
   - Node version: 18+ (20 recommended)
4. Add your `.env` values as **environment variables** in the panel rather
   than uploading a `.env` file directly — most Pterodactyl-based panels let
   you set env vars per-server, which is safer than putting secrets in a
   file that could get included in a backup/export.
5. Run `npm install` from the panel's console (or it may run automatically
   on startup, depending on how the egg is configured), then run
   `npm run deploy` once to register your slash commands, then start the bot.
6. If you switch from `DEV_GUILD_ID`-scoped commands to global commands for
   full launch, remove `DEV_GUILD_ID` from the environment variables and
   run `npm run deploy` again — allow up to an hour for global commands to
   show up everywhere.

## Using Git / version control

```
cd basilisk
git init
git add .
git commit -m "Initial Basilisk skeleton"
```

`.env` is already git-ignored so your tokens won't get committed. Push to a
private GitHub repo, then either pull from it on Wispbyte (if it supports
Git deploys) or upload a zip export each time you update.

## Roadmap / what's stubbed vs. built

**Built now:**
- Command + event auto-loading framework
- `/ping` example command
- `/valorant` example command showing the embed pattern (stats are currently
  hardcoded placeholders — see `src/commands/stats/valorant.js`)
- Shared UAB-branded embed helper (`src/services/embeds.js`)

**Next up (tell me which to tackle first):**
- `src/services/tracker.js` — real Tracker Network API calls for LoL,
  Valorant, Overwatch, Marvel Rivals, Rocket League
- `src/services/startgg.js` — start.gg GraphQL queries for SSBU tournament/
  player data
- Patch note commands — likely scraping or polling official patch note
  pages/RSS per game, then diffing against the last-seen version so the bot
  can also proactively post new patch notes to a channel
- Temp voice channels — a "Join to Create" voice channel + button/command
  flow, backed by the local SQLite DB
- Workout leaderboard commands — `/workout log`, `/leaderboard`, backed by
  the same DB
