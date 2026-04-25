// Discord API error handler for MCP tools
import { ToolResponse } from './tools/types.js';

/**
 * A unified error handler for Discord API errors
 * @param error - The error object from Discord API calls
 * @param clientId - Optional Discord Client ID for custom invite links
 * @returns A standard tool response with error message and potential solution
 */
export function handleDiscordError(error: any, clientId?: string): ToolResponse {
  // Ensure error is in the expected format for checking
  const errorMessage = typeof error === 'string' 
    ? error 
    : error?.message || String(error);
  const errorCode = error?.code;

  // Generate invite link based on client ID if provided
  const inviteLink = clientId 
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=8` 
    : "https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=52076489808";

  // Check for privileged intents errors
  if (errorMessage.includes('Privileged intent provided is not enabled or whitelisted')) {
    return {
      content: [{ 
        type: "text", 
        text: `Error: Privileged intents are not enabled.

Solution: Please enable the required intents (Message Content, Server Members, Presence) in the Discord Developer Portal for your bot application.

For detailed instructions, check the Prerequisites section in our README.` 
      }],
      isError: true
    };
  }

  // Check for unauthorized/bot not in server errors
  if (
    errorCode === 50001 || // Missing Access
    errorCode === 10004 || // Unknown Guild
    errorMessage.includes('Missing Access') ||
    errorMessage.includes('Unknown Guild') ||
    errorMessage.includes('Missing Permissions')
  ) {
    return {
      content: [{ 
        type: "text", 
        text: `Error: The bot is not a member of the target Discord server or lacks required permissions.

Solution: Please add the bot to the target server using this Discord invite link:
${inviteLink}

According to Discord's security model, a bot can only access information from servers it has been explicitly added to.` 
      }],
      isError: true
    };
  }

  // Check for rate limiting
  if (errorCode === 429 || errorMessage.includes('rate limit')) {
    return {
      content: [{ 
        type: "text", 
        text: `Error: Discord API rate limit reached.

Solution: Please wait a moment before trying again. If this persists, consider spacing out your requests.` 
      }],
      isError: true
    };
  }

  // General error response for other cases
  return {
    content: [{ 
      type: "text", 
      text: `Discord API Error: ${errorMessage}` 
    }],
    isError: true
  };
} 