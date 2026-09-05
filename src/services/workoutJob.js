const cron = require('node-cron');
const { baseEmbed } = require('./embeds');
const { getAllWorkoutChannels, getWorkoutLogsForDate } = require('./db');
const { getChicagoDateStr } = require('./dateUtils');

async function postProgressCheck(client) {
  const dateStr = getChicagoDateStr(new Date());
  const channels = getAllWorkoutChannels();

  for (const { guildId, channelId } of channels) {
    try {
      const logs = getWorkoutLogsForDate(guildId, dateStr);
      const channel = await client.channels.fetch(channelId);
      if (!channel) continue;

      const embed = baseEmbed({
        title: '💪 9 PM Workout Progress Check',
        footer: 'Basilisk',
      });

      if (logs.length === 0) {
        embed.setDescription("Nobody has logged a workout yet today. Still time before midnight - `/workout log`!");
      } else {
        const lines = logs.map((l) => `<@${l.userId}> — 🔥 ${l.currentStreak} day streak`);
        embed.setDescription(lines.join('\n'));
      }

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error(`Error posting workout progress check for guild ${guildId}:`, error);
    }
  }
}

function initWorkoutJob(client) {
  cron.schedule(
    '0 21 * * *',
    () => {
      postProgressCheck(client);
    },
    { timezone: 'America/Chicago' }
  );

  console.log('Workout 9 PM progress check job scheduled (America/Chicago).');
}

module.exports = { initWorkoutJob, postProgressCheck };
