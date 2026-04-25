import { z } from "zod";
import { ToolContext, ToolResponse } from "./types.js";
import { 
  AddReactionSchema, 
  AddMultipleReactionsSchema, 
  RemoveReactionSchema,
  DeleteMessageSchema
} from "../schemas.js";
import { handleDiscordError } from "../errorHandler.js";

// Add reaction handler
export async function addReactionHandler(
  args: unknown, 
  context: ToolContext
): Promise<ToolResponse> {
  const { channelId, messageId, emoji } = AddReactionSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const channel = await context.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      return {
        content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
        isError: true
      };
    }

    const message = await channel.messages.fetch(messageId);
    if (!message) {
      return {
        content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }],
        isError: true
      };
    }

    // Add the reaction
    await message.react(emoji);

    return {
      content: [{ 
        type: "text", 
        text: `Successfully added reaction ${emoji} to message ID: ${messageId}` 
      }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

// Add multiple reactions handler
export async function addMultipleReactionsHandler(
  args: unknown, 
  context: ToolContext
): Promise<ToolResponse> {
  const { channelId, messageId, emojis } = AddMultipleReactionsSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const channel = await context.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      return {
        content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
        isError: true
      };
    }

    const message = await channel.messages.fetch(messageId);
    if (!message) {
      return {
        content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }],
        isError: true
      };
    }

    // Add each reaction sequentially
    for (const emoji of emojis) {
      await message.react(emoji);
      // Small delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return {
      content: [{ 
        type: "text", 
        text: `Successfully added ${emojis.length} reactions to message ID: ${messageId}` 
      }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
}

// Remove reaction handler
export async function removeReactionHandler(
  args: unknown, 
  context: ToolContext
): Promise<ToolResponse> {
  const { channelId, messageId, emoji, userId } = RemoveReactionSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const channel = await context.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      return {
        content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
        isError: true
      };
    }

    const message = await channel.messages.fetch(messageId);
    if (!message) {
      return {
        content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }],
        isError: true
      };
    }

    // Get the reactions
    const reactions = message.reactions.cache;
    
    // Find the specific reaction
    const reaction = reactions.find(r => r.emoji.toString() === emoji || r.emoji.name === emoji);
    
    if (!reaction) {
      return {
        content: [{ type: "text", text: `Reaction ${emoji} not found on message ID: ${messageId}` }],
        isError: true
      };
    }
    
    if (userId) {
      // Remove a specific user's reaction
      await reaction.users.remove(userId);
      return {
        content: [{ 
          type: "text", 
          text: `Successfully removed reaction ${emoji} from user ID: ${userId} on message ID: ${messageId}` 
        }]
      };
    } else {
      // Remove bot's reaction
      await reaction.users.remove(context.client.user.id);
      return {
        content: [{ 
          type: "text", 
          text: `Successfully removed bot's reaction ${emoji} from message ID: ${messageId}` 
        }]
      };
    }
  } catch (error) {
    return handleDiscordError(error);
  }
}

// Delete message handler
export async function deleteMessageHandler(
  args: unknown, 
  context: ToolContext
): Promise<ToolResponse> {
  const { channelId, messageId, reason } = DeleteMessageSchema.parse(args);
  try {
    if (!context.client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const channel = await context.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      return {
        content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
        isError: true
      };
    }

    // Fetch the message
    const message = await channel.messages.fetch(messageId);
    if (!message) {
      return {
        content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }],
        isError: true
      };
    }

    // Delete the message
    await message.delete();

    return {
      content: [{ 
        type: "text", 
        text: `Successfully deleted message with ID: ${messageId} from channel: ${channelId}` 
      }]
    };
  } catch (error) {
    return handleDiscordError(error);
  }
} 