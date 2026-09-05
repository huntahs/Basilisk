const { Events } = require('discord.js');
const { getPokemonRound, hasPokemonUserBeenCredited, addPokemonCreditedUser } = require('../services/db');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const round = getPokemonRound(message.guild.id);
    if (!round) return;
    if (message.channel.id !== round.channelId) return;

    const guess = message.content.trim().toLowerCase();
    if (guess !== round.answer) return;

    // Anyone can win, but only once per round per person - if they've
    // already been credited today, leave their message alone (they're
    // probably just discussing the answer, not re-guessing).
    if (hasPokemonUserBeenCredited(message.guild.id, message.author.id)) return;

    // Mark credited FIRST (before any await) so a near-simultaneous second
    // message from the same person can't slip through and get double credit.
    addPokemonCreditedUser(message.guild.id, message.author.id);

    const authorId = message.author.id;

    try {
      await message.delete();
    } catch (error) {
      // Most likely a missing "Manage Messages" permission, or the message
      // was already removed by someone else - either way, still announce
      // credit below rather than failing silently.
      console.error('Error deleting correct Pokemon guess message:', error);
    }

    try {
      // A genuine Discord reply (not just a text link) - this shows the
      // native quote-reference UI and lets people click it to jump straight
      // to the original silhouette post.
      await message.channel.send({
        content: `✅ <@${authorId}> got it right!`,
        reply: { messageReference: round.messageId },
      });
    } catch (error) {
      // Most likely the original post is no longer reachable (e.g. deleted).
      // Fall back to a plain message so credit still gets announced.
      console.error('Error replying to original Pokemon post, falling back to plain message:', error);
      try {
        await message.channel.send(`✅ <@${authorId}> got it right!`);
      } catch (fallbackError) {
        console.error('Error sending Pokemon credit fallback message:', fallbackError);
      }
    }
  },
};
