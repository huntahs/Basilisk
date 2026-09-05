const { Events } = require('discord.js');
const { isTrackedWorkoutMessage, removeWorkoutRecordByMessageId } = require('../services/db');

// If a workout submission message gets deleted (by the submitter, a mod,
// or anyone with permission), make sure the leaderboard entry is gone too -
// this is what makes /workout leaderboard automatically stay in sync with
// whatever proof messages still actually exist.
module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (isTrackedWorkoutMessage(message.id)) {
      removeWorkoutRecordByMessageId(message.id);
      console.log(`Removed workout record for deleted message ${message.id}`);
    }
  },
};
