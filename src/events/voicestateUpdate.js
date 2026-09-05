const { Events, ChannelType } = require('discord.js');
const { isHubChannel, addTempChannel, isTempChannel, removeTempChannel } = require('../services/db');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    // --- Someone joined a hub channel: give them their own temp channel ---
    if (newState.channelId && isHubChannel(newState.channelId)) {
      const hubChannel = newState.channel;
      const guild = newState.guild;
      const member = newState.member;

      try {
        const tempChannel = await guild.channels.create({
          name: `${member.displayName}'s Channel`.slice(0, 100),
          type: ChannelType.GuildVoice,
          parent: hubChannel.parentId || null,
          bitrate: hubChannel.bitrate,
          userLimit: hubChannel.userLimit,
        });

        addTempChannel(tempChannel.id, guild.id, hubChannel.id, member.id);
        await member.voice.setChannel(tempChannel);
      } catch (error) {
        console.error('Error creating temp voice channel:', error);
      }
      return;
    }

    // --- Someone left a bot-created temp channel: delete it if now empty ---
    const oldChannelId = oldState.channelId;
    if (oldChannelId && oldChannelId !== newState.channelId && isTempChannel(oldChannelId)) {
      const oldChannel = oldState.channel;
      if (oldChannel && oldChannel.members.size === 0) {
        try {
          await oldChannel.delete('Temporary voice channel emptied.');
        } catch (error) {
          console.error('Error deleting empty temp voice channel:', error);
        }
        removeTempChannel(oldChannelId);
      }
    }
  },
};
