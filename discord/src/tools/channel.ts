import { z } from "zod";
import { ChannelType } from "discord.js";
import { ToolContext, ToolResponse } from "./types.js";
import { 
  CreateTextChannelSchema, 
  DeleteChannelSchema, 
  ReadMessagesSchema,
  CreateCategorySchema,
  EditCategorySchema,
  DeleteCategorySchema
} from "../schemas.js";
import { handleDiscordError } from "../errorHandler.js";

  // Category creation handler
export async function createCategoryHandler(
  args: unknown,
  context: ToolContext
): Promise<ToolResponse> {
  const { guildId, name, position, reason } = CreateCategorySchema.parse(args);
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
    const options: any = { name, type: ChannelType.GuildCategory };
    if (typeof position === "number") options.position = position;
    if (reason) options.reason = reason;
    const category = await guild.channels.create(options);
    return {
      content: [{ type: "text", text: `Successfully created category "${name}" with ID: ${category.id}` }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

// Category edit handler
export async function editCategoryHandler(
  args: unknown,
  context: ToolContext
): Promise<ToolResponse> {
  const { categoryId, name, position, reason } = EditCategorySchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }
    const category = await context.client.channels.fetch(categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return {
        content: [{ type: "text", text: `Cannot find category with ID: ${categoryId}` }],
        isError: true
      };
    }
    const update: any = {};
    if (name) update.name = name;
    if (typeof position === "number") update.position = position;
    if (reason) update.reason = reason;
    await category.edit(update);
    return {
      content: [{ type: "text", text: `Successfully edited category with ID: ${categoryId}` }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

// Category deletion handler
export async function deleteCategoryHandler(
  args: unknown,
  context: ToolContext
): Promise<ToolResponse> {
  const { categoryId, reason } = DeleteCategorySchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }
    const category = await context.client.channels.fetch(categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return {
        content: [{ type: "text", text: `Cannot find category with ID: ${categoryId}` }],
        isError: true
      };
    }
    await category.delete(reason || "Category deleted via API");
    return {
      content: [{ type: "text", text: `Successfully deleted category with ID: ${categoryId}` }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

  // Text channel creation handler
export async function createTextChannelHandler(
  args: unknown, 
  context: ToolContext
): Promise<ToolResponse> {
  const { guildId, channelName, topic, reason } = CreateTextChannelSchema.parse(args);
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

    // Create the text channel
    const channelOptions: any = {
      name: channelName,
      type: ChannelType.GuildText
    };
    if (topic) channelOptions.topic = topic;
    if (reason) channelOptions.reason = reason;
    const channel = await guild.channels.create(channelOptions);

    return {
      content: [{ 
        type: "text", 
        text: `Successfully created text channel "${channelName}" with ID: ${channel.id}` 
      }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

// Channel deletion handler
export async function deleteChannelHandler(
  args: unknown, 
  context: ToolContext
): Promise<ToolResponse> {
  const { channelId, reason } = DeleteChannelSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const channel = await context.client.channels.fetch(channelId);
    if (!channel) {
      return {
        content: [{ type: "text", text: `Cannot find channel with ID: ${channelId}` }],
        isError: true
      };
    }

    // Check if channel can be deleted (has delete method)
    if (!('delete' in channel)) {
      return {
        content: [{ type: "text", text: `This channel type does not support deletion or the bot lacks permissions` }],
        isError: true
      };
    }

    // Delete the channel
    await channel.delete(reason || "Channel deleted via API");

    return {
      content: [{ 
        type: "text", 
        text: `Successfully deleted channel with ID: ${channelId}` 
      }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

// Message reading handler
export async function readMessagesHandler(
  args: unknown, 
  context: ToolContext
): Promise<ToolResponse> {
  const { channelId, limit } = ReadMessagesSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const channel = await context.client.channels.fetch(channelId);
    if (!channel) {
      return {
        content: [{ type: "text", text: `Cannot find channel with ID: ${channelId}` }],
        isError: true
      };
    }

    // Check if channel has messages (text channel, thread, etc.)
    if (!channel.isTextBased() || !('messages' in channel)) {
      return {
        content: [{ type: "text", text: `Channel type does not support reading messages` }],
        isError: true
      };
    }

    // Fetch messages
    const messages = await channel.messages.fetch({ limit });
    
    if (messages.size === 0) {
      return {
        content: [{ type: "text", text: `No messages found in channel` }]
      };
    }

    // Format messages 
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      content: msg.content,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        bot: msg.author.bot
      },
      timestamp: msg.createdAt,
      attachments: msg.attachments.size,
      embeds: msg.embeds.length,
      replyTo: msg.reference ? msg.reference.messageId : null
    })).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          channelId,
          messageCount: formattedMessages.length,
          messages: formattedMessages
        }, null, 2) 
      }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}
