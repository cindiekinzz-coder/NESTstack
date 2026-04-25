import { SendMessageSchema } from '../schemas.js';
import { ToolHandler } from './types.js';
import { handleDiscordError } from "../errorHandler.js";

export const sendMessageHandler: ToolHandler = async (args, { client }) => {
  const { channelId, message, replyToMessageId } = SendMessageSchema.parse(args);
  
  try {
    if (!client.isReady()) {
      return {
        content: [{ type: "text", text: "Discord client not logged in." }],
        isError: true
      };
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return {
        content: [{ type: "text", text: `Cannot find text channel ID: ${channelId}` }],
        isError: true
      };
    }

    // Ensure channel is text-based and can send messages
    if ('send' in channel) {
      // Build message options
      const messageOptions: any = {};
      
      // If replyToMessageId is provided, verify the message exists and add reply option
      if (replyToMessageId) {
        if ('messages' in channel) {
          try {
            // Verify the message exists
            await channel.messages.fetch(replyToMessageId);
            messageOptions.reply = { messageReference: replyToMessageId };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Cannot find message with ID: ${replyToMessageId} in channel ${channelId}` }],
              isError: true
            };
          }
        } else {
          return {
            content: [{ type: "text", text: `This channel type does not support message replies` }],
            isError: true
          };
        }
      }
      
      // Set the message content
      messageOptions.content = message;
      
      await channel.send(messageOptions);
      
      const responseText = replyToMessageId 
        ? `Message successfully sent to channel ID: ${channelId} as a reply to message ID: ${replyToMessageId}`
        : `Message successfully sent to channel ID: ${channelId}`;
      
      return {
        content: [{ type: "text", text: responseText }]
      };
    } else {
      return {
        content: [{ type: "text", text: `This channel type does not support sending messages` }],
        isError: true
      };
    }
  } catch (error) {
    return handleDiscordError(error);
  }
}; 