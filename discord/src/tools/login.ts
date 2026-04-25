import { DiscordLoginSchema } from '../schemas.js';
import { ToolHandler } from './types.js';
import { handleDiscordError } from "../errorHandler.js";
import { info, error } from '../logger.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { createToolContext } from './tools.js';

// Create a function to properly wait for client to be ready
async function waitForReady(client: Client, token: string, timeoutMs = 30000): Promise<Client> {
  return new Promise((resolve, reject) => {
    // Set a timeout to prevent hanging if ready event never fires
    const timeout = setTimeout(() => {
      reject(new Error(`Client ready event timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    // If client is already ready, resolve immediately
    if (client.isReady()) {
      clearTimeout(timeout);
      resolve(client);
      return;
    }
    
    // Listen for ready event
    const readyHandler = () => {
      info('Client ready event received');
      clearTimeout(timeout);
      resolve(client);
    };
    
    // Listen for error event
    const errorHandler = (err: Error) => {
      clearTimeout(timeout);
      client.removeListener('ready', readyHandler);
      reject(err);
    };
    
    // Attach listeners
    client.once('ready', readyHandler);
    client.once('error', errorHandler);
    
    // Start login process
    info('Starting login process and waiting for ready event');
    client.login(token).catch((err: Error) => {
      clearTimeout(timeout);
      client.removeListener('ready', readyHandler);
      client.removeListener('error', errorHandler);
      reject(err);
    });
  });
}

export const loginHandler: ToolHandler = async (args, context) => {
  DiscordLoginSchema.parse(args);
  try {
        // Check if client is already logged in
        if (context.client.isReady()) {
          return {
            content: [{ type: "text", text: `Already logged in as: ${context.client.user?.tag}` }]
          };
        }
        
        // Use token from args if provided, otherwise fall back to the client's token
        const token = args.token || context.client.token;
        
        // Check if we have a token to use
        if (!token) {
          return {
            content: [{ type: "text", text: "Discord token not provided and not configured. Cannot log in. Please check the following: 1. Provide a token in the login command or make sure the token is correctly set in your config or environment variables. 2. Ensure all required privileged intents (Message Content, Server Members, Presence) are enabled in the Discord Developer Portal for your bot application." }],
            isError: true
          };
        }
        
        // If token is provided in args, update the client's token
        if (args.token) {
          context.client.token = args.token;
        }
        
        // Attempt to log in with the token and get the ready client
        const readyClient = await waitForReady(context.client, token);
        // Update the context client with the ready client
        context.client = readyClient;
        return {
          content: [{ type: "text", text: `Successfully logged in to Discord: ${context.client.user?.tag}` }]
        };
  } catch (err) {
    error(`Error in login handler: ${err instanceof Error ? err.message : String(err)}`);
    return handleDiscordError(err);
  }
}; 