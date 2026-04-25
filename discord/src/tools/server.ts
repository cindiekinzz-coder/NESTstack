import { ChannelType } from "discord.js";
import { handleDiscordError } from "../errorHandler.js";
import { GetServerInfoSchema, ListServersSchema, SearchMessagesSchema } from "../schemas.js";
import { ToolContext, ToolResponse } from "./types.js";


// Search server messages handler
export async function searchMessagesHandler(
  args: unknown,
  context: ToolContext
): Promise<ToolResponse> {
  const { guildId, content, authorId, mentions, has, maxId, minId, channelId, pinned, authorType, sortBy, sortOrder, limit, offset } = SearchMessagesSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const guild = await context.client.guilds.fetch(guildId);
    if (!guild) {
      return {
        content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }],
        isError: true
      };
    }

    // Note: Discord.js does not support guild message search natively.
    // This requires direct API calls or using a library that supports it.
    // Here we will construct the API request using context.client.rest
    const params = new URLSearchParams();
    if (content) params.append('content', content);
    if (authorId) params.append('author_id', authorId);
    if (mentions) params.append('mentions', mentions);
    if (has) params.append('has', has);
    if (maxId) params.append('max_id', maxId);
    if (minId) params.append('min_id', minId);
    if (channelId) params.append('channel_id', channelId);
    if (typeof pinned === 'boolean') params.append('pinned', String(pinned));
    if (authorType) params.append('author_type', authorType);
    if (sortBy) params.append('sort_by', sortBy);
    if (sortOrder) params.append('sort_order', sortOrder);
    params.append('limit', String(limit || 25));
    params.append('offset', String(offset || 0));

    const response = await context.client.rest.get(`/guilds/${guildId}/messages/search?${params.toString()}`);

    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

// List servers handler
export async function listServersHandler(
  args: unknown,
  context: ToolContext
): Promise<ToolResponse> {
  ListServersSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const guilds = await context.client.guilds.fetch();

    if (guilds.size === 0) {
      return {
        content: [{ type: "text", text: "No servers found. The bot is not a member of any servers." }]
      };
    }

    const guildsInfo = guilds.map(guild => ({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL()
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(guildsInfo, null, 2) }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

// Server information handler
export async function getServerInfoHandler(
  args: unknown,
  context: ToolContext
): Promise<ToolResponse> {
  const { guildId } = GetServerInfoSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const guild = await context.client.guilds.fetch(guildId);
    if (!guild) {
      return {
        content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }],
        isError: true
      };
    }

    // Fetch additional server data
    await guild.fetch();

    // Fetch channel information
    const channels = await guild.channels.fetch();

    // Categorize channels by type
    const channelsByType = {
      text: channels.filter(c => c?.type === ChannelType.GuildText).size,
      voice: channels.filter(c => c?.type === ChannelType.GuildVoice).size,
      category: channels.filter(c => c?.type === ChannelType.GuildCategory).size,
      forum: channels.filter(c => c?.type === ChannelType.GuildForum).size,
      announcement: channels.filter(c => c?.type === ChannelType.GuildAnnouncement).size,
      stage: channels.filter(c => c?.type === ChannelType.GuildStageVoice).size,
      total: channels.size
    };

    // Get detailed information for all channels
    const channelDetails = channels.map(channel => {
      if (!channel) return null;

      return {
        id: channel.id,
        name: channel.name,
        type: ChannelType[channel.type] || channel.type,
        categoryId: channel.parentId,
        position: channel.position,
        // Only add topic for text channels
        topic: 'topic' in channel ? channel.topic : null,
      };
    }).filter(c => c !== null); // Filter out null values


    // Group channels by type
    const groupedChannels = {
      text: channelDetails.filter(c => c.type === ChannelType[ChannelType.GuildText] || c.type === ChannelType.GuildText),
      voice: channelDetails.filter(c => c.type === ChannelType[ChannelType.GuildVoice] || c.type === ChannelType.GuildVoice),
      category: channelDetails.filter(c => c.type === ChannelType[ChannelType.GuildCategory] || c.type === ChannelType.GuildCategory),
      forum: channelDetails.filter(c => c.type === ChannelType[ChannelType.GuildForum] || c.type === ChannelType.GuildForum),
      announcement: channelDetails.filter(c => c.type === ChannelType[ChannelType.GuildAnnouncement] || c.type === ChannelType.GuildAnnouncement),
      stage: channelDetails.filter(c => c.type === ChannelType[ChannelType.GuildStageVoice] || c.type === ChannelType.GuildStageVoice),
      all: channelDetails
    };

    // Get member count
    const approximateMemberCount = guild.approximateMemberCount || "unknown";

    // Format guild information
    const guildInfo = {
      id: guild.id,
      name: guild.name,
      description: guild.description,
      icon: guild.iconURL(),
      owner: guild.ownerId,
      createdAt: guild.createdAt,
      memberCount: approximateMemberCount,
      channels: {
        count: channelsByType,
        details: groupedChannels
      },
      features: guild.features,
      premium: {
        tier: guild.premiumTier,
        subscriptions: guild.premiumSubscriptionCount
      }
    };

    return {
      content: [{ type: "text", text: JSON.stringify(guildInfo, null, 2) }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

