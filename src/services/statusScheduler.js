// Unified bot status resolver - this is the ONLY place that should ever
// call client.user.setActivity(), so the Instagram announcement status and
// the day/time schedule below don't fight each other for control.
//
// Priority order (highest to lowest):
//   1. Instagram new-post status (24 hours after a real new post)
//   2. Tuesday 6-9 PM Central: Magic City Smash special window
//   3. General schedule:
//      - 12:00 AM - 11:59 AM (every day): today's holiday from holidays2026.json
//      - 12:01 PM - 11:59 PM on weekdays: that day's competing game
//      - 12:00 PM - 11:59 PM on weekends: "Weekend Recovery Simulator"
//
// NOTE: Discord bots can only use 5 standard activity types (Playing,
// Streaming, Listening, Watching, Competing) - "Custom Status" with
// arbitrary no-verb text is a personal-account-only feature at the Discord
// API level, not available to bots at all, regardless of library support.

const cron = require('node-cron');
const { ActivityType } = require('discord.js');
const { getTemporaryBotStatus } = require('./db');
const HOLIDAYS = require('../data/holidays2026.json');

const WEEKDAY_GAMES = {
  Monday: 'Valorant',
  Tuesday: 'Marvel Rivals',
  Wednesday: 'Rocket League',
  Thursday: 'League of Legends',
  Friday: 'Overwatch 2',
};

// All times are evaluated in Central time (America/Chicago), matching
// UAB's own timezone, regardless of what timezone the host server runs in.
function getChicagoDateParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
    weekday: 'long',
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;

  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some Intl implementations return "24" for midnight instead of "00"

  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    hour,
    weekday: map.weekday, // e.g. "Monday"
  };
}

function resolveActivity(now = new Date()) {
  // 1. Instagram override - highest priority
  const igStatus = getTemporaryBotStatus();
  if (igStatus && now.getTime() < igStatus.expiresAt) {
    return { type: ActivityType.Watching, name: 'New Post on Our Instagram! :D' };
  }

  const { dateStr, hour, weekday } = getChicagoDateParts(now);

  // 2. Tuesday 6-9 PM Central: Magic City Smash special window
  if (weekday === 'Tuesday' && hour >= 18 && hour < 21) {
    return { type: ActivityType.Competing, name: 'Magic City Smash' };
  }

  // 3a. Midnight - noon: today's holiday
  if (hour < 12) {
    const holiday = HOLIDAYS[dateStr] || 'a Mystery Holiday';
    return { type: ActivityType.Playing, name: holiday };
  }

  // 3b. Noon - midnight on weekends: Weekend Recovery Simulator
  const isWeekend = weekday === 'Saturday' || weekday === 'Sunday';
  if (isWeekend) {
    return { type: ActivityType.Playing, name: 'Weekend Recovery Simulator' };
  }

  // 3c. Noon - midnight on weekdays: that day's competing game
  const game = WEEKDAY_GAMES[weekday];
  if (game) {
    return { type: ActivityType.Competing, name: game };
  }

  return null; // shouldn't happen - the above covers all 7 days, all 24 hours
}

function applyCurrentActivity(client) {
  const activity = resolveActivity();
  if (!activity) {
    client.user.setActivity(null);
    return;
  }
  client.user.setActivity(activity.name, { type: activity.type });
}

function initStatusScheduler(client) {
  applyCurrentActivity(client); // set the correct status immediately on startup

  // Re-evaluate every 15 minutes - frequent enough to catch the 3-hour
  // Tuesday window and the noon/midnight transitions reasonably promptly.
  cron.schedule(
    '*/15 * * * *',
    () => {
      applyCurrentActivity(client);
    },
    { timezone: 'America/Chicago' }
  );

  console.log('Status scheduler running (every 15 min, America/Chicago).');
}

module.exports = { initStatusScheduler, resolveActivity, applyCurrentActivity };
